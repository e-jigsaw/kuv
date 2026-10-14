import { pathToFileURL } from "node:url";
import type { ImageVariant } from "@kuv/shared";
import pg from "pg";
import { env } from "../env";
import {
  createS3BlobStore,
  derivativeBlobKey,
  fileKey,
  type BlobStore,
} from "../services/blob-store";

// bytea → BlobStore の一括移行 CLI。
// copy: data が残ってる行を put（サイズ一致の object は飛ばすので再実行しても冪等）
// verify: 全行の object 存在とサイズ（data がある行のみ）を照合
export interface MigrateResult {
  checked: number;
  copied: number;
  skipped: number;
  bytes: number;
  missing: string[];
  mismatched: string[];
}

interface Row {
  id: string;
  blobKey: string;
  filetype: string;
  size: number | null;
}

// 対象テーブルごとの読み出し定義。keyset pagination（id 昇順）でバッチ読みする
const SOURCES = [
  {
    table: "image_file",
    select: "id, image_id, variant, filetype, octet_length(data)::int as size",
    toKey: (r: { image_id: string; variant: string }) => fileKey(r.image_id, r.variant as ImageVariant),
  },
  {
    table: "image_derivative",
    select: "id, image_id, key, filetype, octet_length(data)::int as size",
    toKey: (r: { image_id: string; key: string }) => derivativeBlobKey(r.image_id, r.key),
  },
] as const;

async function* rows(pool: pg.Pool, batchSize: number): AsyncGenerator<Row> {
  for (const src of SOURCES) {
    let last = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const { rows: batch } = await pool.query(
        `select ${src.select} from ${src.table} where id > $1 order by id limit $2`,
        [last, batchSize],
      );
      if (batch.length === 0) break;
      for (const r of batch) {
        yield { id: r.id, blobKey: src.toKey(r), filetype: r.filetype, size: r.size };
      }
      last = batch[batch.length - 1].id;
    }
  }
}

async function readData(pool: pg.Pool, blobKey: string, id: string): Promise<Buffer> {
  const table = blobKey.includes("/d/") ? "image_derivative" : "image_file";
  const { rows: r } = await pool.query(`select data from ${table} where id = $1`, [id]);
  return Buffer.from(r[0].data);
}

export async function runMigrateBlobs(opts: {
  pool: pg.Pool;
  blob: BlobStore;
  mode: "copy" | "verify";
  batchSize?: number;
  log?: (line: string) => void;
}): Promise<MigrateResult> {
  const { pool, blob, mode } = opts;
  const batchSize = opts.batchSize ?? 50;
  const log = opts.log ?? ((l) => console.log(l));
  const res: MigrateResult = { checked: 0, copied: 0, skipped: 0, bytes: 0, missing: [], mismatched: [] };

  for await (const row of rows(pool, batchSize)) {
    res.checked++;
    const head = await blob.head(row.blobKey);

    if (mode === "verify") {
      if (!head) res.missing.push(row.blobKey);
      else if (row.size !== null && head.size !== row.size) res.mismatched.push(row.blobKey);
    } else if (row.size === null || (head && head.size === row.size)) {
      res.skipped++;
    } else {
      // data は 1 行ずつ読む（バッチで bytea を抱えるとメモリを食うため）
      await blob.put(row.blobKey, await readData(pool, row.blobKey, row.id), row.filetype);
      res.copied++;
      res.bytes += row.size;
    }

    if (res.checked % 500 === 0) {
      log(`${mode}: checked=${res.checked} copied=${res.copied} bytes=${res.bytes}`);
    }
  }

  log(
    `${mode} done: checked=${res.checked} copied=${res.copied} skipped=${res.skipped} bytes=${res.bytes} missing=${res.missing.length} mismatched=${res.mismatched.length}`,
  );
  return res;
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--verify") ? "verify" : "copy";
  const pool = new pg.Pool(env.db());
  try {
    const res = await runMigrateBlobs({ pool, blob: createS3BlobStore(env.s3()), mode });
    if (mode === "verify" && (res.missing.length > 0 || res.mismatched.length > 0)) {
      for (const k of res.missing.slice(0, 20)) console.error(`missing: ${k}`);
      for (const k of res.mismatched.slice(0, 20)) console.error(`mismatched: ${k}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

// CLI として直接実行された時だけ main を走らせる（テストからの import では走らせない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
