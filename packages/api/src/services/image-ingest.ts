import { createHash } from "node:crypto";
import type { SupportedMime } from "@picsur/shared";
import sharp from "sharp";
import { detectImageType } from "./filetype";

export interface IngestFile {
  filetype: SupportedMime;
  data: Buffer;
}

export interface IngestResult {
  id: string;
  master: IngestFile;
  original?: IngestFile;
}

// mime → sharp の出力フォーマット
export const OUTPUT_FORMAT: Record<SupportedMime, "png" | "jpeg" | "webp" | "gif"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// 元形式を維持したまま再エンコードし exif/metadata を除去（アニメはフレーム保持）。
// 非対応形式なら null。
export async function processImage(
  buf: Buffer,
  keepOriginal: boolean,
): Promise<IngestResult | null> {
  const detected = await detectImageType(buf);
  if (!detected) return null;

  const fmt = OUTPUT_FORMAT[detected.mime];
  // sharp は withMetadata() 未指定時にメタデータを strip する（デフォルト動作）。
  const masterData = await sharp(buf, { animated: true })
    .toFormat(fmt)
    .toBuffer();

  const result: IngestResult = {
    id: hashBuffer(buf),
    master: { filetype: detected.mime, data: masterData },
  };
  if (keepOriginal) {
    result.original = { filetype: detected.mime, data: buf };
  }
  return result;
}
