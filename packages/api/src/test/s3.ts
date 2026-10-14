import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { GenericContainer, Wait } from "testcontainers";
import type { S3Config } from "../services/blob-store";

// 契約テスト用の S3 互換サーバ (SeaweedFS) を起動し、bucket を作って返す。
// 本番 MinIO (2023) との互換性は切り替え時に確認する。
export async function startTestS3(): Promise<{
  config: S3Config;
  teardown: () => Promise<void>;
}> {
  const container = await new GenericContainer("chrislusf/seaweedfs:3.97")
    .withCommand(["server", "-s3", "-dir=/data"])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const config: S3Config = {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(8333)}`,
    region: "us-east-1",
    bucket: "kuv-test",
    accessKeyId: "kuvtest",
    secretAccessKey: "kuvtest-secret",
  };
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  // ポートが開いても S3 API が応答するまで時間がかかるので CreateBucket をリトライする
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      break;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  client.destroy();

  return { config, teardown: async () => void (await container.stop()) };
}
