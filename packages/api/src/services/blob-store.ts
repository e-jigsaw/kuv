import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ImageVariant } from "@kuv/shared";

// 画像バイナリの置き場。S3 依存はこのモジュールに閉じ込める。
export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  // 存在しなければ null
  get(key: string): Promise<Buffer | null>;
  head(key: string): Promise<{ size: number } | null>;
  // 存在しない key は成功扱い
  delete(keys: string[]): Promise<void>;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// image_file の key。image_id は内容の sha256 なので上書きは起きない
export function fileKey(imageId: string, variant: ImageVariant): string {
  return `${imageId}/${variant}`;
}

// image_derivative の key（key は derivativeKey(mime) の値）
export function derivativeBlobKey(imageId: string, key: string): string {
  return `${imageId}/d/${key}`;
}

// テスト用のインメモリ実装
export function createMemoryBlobStore(): BlobStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(key, data) {
      objects.set(key, Buffer.from(data));
    },
    async get(key) {
      const v = objects.get(key);
      return v ? Buffer.from(v) : null;
    },
    async head(key) {
      const v = objects.get(key);
      return v ? { size: v.length } : null;
    },
    async delete(keys) {
      for (const k of keys) objects.delete(k);
    },
  };
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

export function createS3BlobStore(config: S3Config): BlobStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // 本番 MinIO (2023-03) は新しい SDK 既定の checksum ヘッダを前提にできないため、必須時だけにする
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;

  return {
    async put(key, data, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: data, ContentType: contentType, ContentLength: data.length }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!res.Body) return null;
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: res.ContentLength ?? 0 };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async delete(keys) {
      // DeleteObjects（一括）は Content-MD5/checksum 必須で古い MinIO と相性が悪いので 1 件ずつ
      for (const key of keys) {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      }
    },
  };
}
