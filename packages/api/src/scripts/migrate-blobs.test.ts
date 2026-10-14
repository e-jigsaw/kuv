import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import { createMemoryBlobStore, type BlobStore } from "../services/blob-store";
import { runMigrateBlobs } from "./migrate-blobs";

let t: TestDb;
let adminId: string;

beforeAll(async () => {
  t = await startTestDb();
  adminId = await seedAdmin(t.db, "admin", "hash");
});

afterAll(async () => {
  await t.teardown();
});

beforeEach(async () => {
  await t.pool.query("delete from image");
});

// 旧形式（bytea に実バイトがある）の行を直接作る
async function seedLegacy(id: string, master: Buffer, original?: Buffer, deriv?: Buffer) {
  await t.pool.query("insert into image (id, user_id, file_name) values ($1, $2, 'x')", [id, adminId]);
  await t.pool.query(
    "insert into image_file (image_id, variant, filetype, data) values ($1, 'master', 'image/png', $2)",
    [id, master],
  );
  if (original) {
    await t.pool.query(
      "insert into image_file (image_id, variant, filetype, data) values ($1, 'original', 'image/png', $2)",
      [id, original],
    );
  }
  if (deriv) {
    await t.pool.query(
      "insert into image_derivative (image_id, key, filetype, data) values ($1, 'dk', 'image/webp', $2)",
      [id, deriv],
    );
  }
}

function countingPuts(store: BlobStore): { store: BlobStore; puts: () => number } {
  let n = 0;
  return {
    store: { ...store, put: async (k, d, ct) => { n++; await store.put(k, d, ct); } },
    puts: () => n,
  };
}

test("copy puts every legacy blob under its key and verify passes", async () => {
  await seedLegacy("m1", Buffer.from([1, 2]), Buffer.from([3]), Buffer.from([4, 4, 4]));
  await seedLegacy("m2", Buffer.from([5]));
  const blob = createMemoryBlobStore();

  const copy = await runMigrateBlobs({ pool: t.pool, blob, mode: "copy", batchSize: 1, log: () => {} });
  expect(copy.copied).toBe(4);
  expect(copy.bytes).toBe(2 + 1 + 3 + 1);
  expect(await blob.get("m1/master")).toEqual(Buffer.from([1, 2]));
  expect(await blob.get("m1/original")).toEqual(Buffer.from([3]));
  expect(await blob.get("m1/d/dk")).toEqual(Buffer.from([4, 4, 4]));
  expect(await blob.get("m2/master")).toEqual(Buffer.from([5]));

  const verify = await runMigrateBlobs({ pool: t.pool, blob, mode: "verify", log: () => {} });
  expect(verify.checked).toBe(4);
  expect(verify.missing).toEqual([]);
  expect(verify.mismatched).toEqual([]);
});

test("a second copy skips objects that already match", async () => {
  await seedLegacy("m3", Buffer.from([1, 2, 3]));
  const { store, puts } = countingPuts(createMemoryBlobStore());
  await runMigrateBlobs({ pool: t.pool, blob: store, mode: "copy", log: () => {} });
  expect(puts()).toBe(1);
  const second = await runMigrateBlobs({ pool: t.pool, blob: store, mode: "copy", log: () => {} });
  expect(puts()).toBe(1);
  expect(second.skipped).toBe(1);
  expect(second.copied).toBe(0);
});

test("copy re-puts an object whose size does not match", async () => {
  await seedLegacy("m4", Buffer.from([1, 2, 3]));
  const blob = createMemoryBlobStore();
  await blob.put("m4/master", Buffer.from([9]), "image/png");
  const res = await runMigrateBlobs({ pool: t.pool, blob, mode: "copy", log: () => {} });
  expect(res.copied).toBe(1);
  expect(await blob.get("m4/master")).toEqual(Buffer.from([1, 2, 3]));
});

test("verify reports missing and size-mismatched objects", async () => {
  await seedLegacy("m5", Buffer.from([1, 2]), Buffer.from([3]));
  const blob = createMemoryBlobStore();
  await blob.put("m5/master", Buffer.from([1]), "image/png"); // サイズ不一致
  const res = await runMigrateBlobs({ pool: t.pool, blob, mode: "verify", log: () => {} });
  expect(res.mismatched).toEqual(["m5/master"]);
  expect(res.missing).toEqual(["m5/original"]);
});

test("verify checks only existence for rows with null data", async () => {
  await t.pool.query("insert into image (id, user_id, file_name) values ('n1', $1, 'x')", [adminId]);
  await t.pool.query(
    "insert into image_file (image_id, variant, filetype, data) values ('n1', 'master', 'image/png', null)",
  );
  const blob = createMemoryBlobStore();
  const before = await runMigrateBlobs({ pool: t.pool, blob, mode: "verify", log: () => {} });
  expect(before.missing).toEqual(["n1/master"]);

  await blob.put("n1/master", Buffer.from([7, 7, 7, 7]), "image/png");
  const copy = await runMigrateBlobs({ pool: t.pool, blob, mode: "copy", log: () => {} });
  expect(copy.copied).toBe(0);
  const after = await runMigrateBlobs({ pool: t.pool, blob, mode: "verify", log: () => {} });
  expect(after.missing).toEqual([]);
  expect(after.mismatched).toEqual([]);
});
