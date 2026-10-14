import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import { insertDerivative } from "../db/image-queries";
import { createMemoryBlobStore, type BlobStore } from "./blob-store";
import { removeImage, saveImage } from "./image-store";

let t: TestDb;
let adminId: string;

beforeAll(async () => {
  t = await startTestDb();
  adminId = await seedAdmin(t.db, "admin", "hash");
});

afterAll(async () => {
  await t.teardown();
});

const png = (b: number[]) => ({ filetype: "image/png" as const, data: Buffer.from(b) });

test("saveImage puts master and original then inserts rows without data", async () => {
  const blob = createMemoryBlobStore();
  await saveImage(t.db, blob, { id: "s1", userId: adminId, fileName: "s1.png" }, png([1]), png([2, 2]));
  expect(await blob.head("s1/master")).toEqual({ size: 1 });
  expect(await blob.head("s1/original")).toEqual({ size: 2 });
  const { rows } = await t.pool.query(
    "select count(*)::int as n from image_file where image_id = $1 and data is null",
    ["s1"],
  );
  expect(rows[0].n).toBe(2);
});

test("saveImage removes put objects when the DB insert fails", async () => {
  const blob = createMemoryBlobStore();
  // 存在しない user_id で FK 違反を起こす
  await expect(
    saveImage(
      t.db,
      blob,
      { id: "s2", userId: "00000000-0000-0000-0000-000000000000", fileName: "s2.png" },
      png([1]),
      png([2]),
    ),
  ).rejects.toThrow();
  expect(await blob.head("s2/master")).toBe(null);
  expect(await blob.head("s2/original")).toBe(null);
});

test("saveImage keeps objects when a row for the same id already exists", async () => {
  const blob = createMemoryBlobStore();
  const meta = { id: "s4", userId: adminId, fileName: "s4.png" };
  await saveImage(t.db, blob, meta, png([1]), png([2]));
  // 同じ id の二重 insert は PK 違反。先行 upload の object は消してはいけない
  await expect(saveImage(t.db, blob, meta, png([1]), png([2]))).rejects.toThrow();
  expect(await blob.head("s4/master")).toEqual({ size: 1 });
  expect(await blob.head("s4/original")).toEqual({ size: 1 });
});

test("saveImage leaves no row when blob.put fails", async () => {
  const failing: BlobStore = {
    ...createMemoryBlobStore(),
    put: async () => {
      throw new Error("s3 down");
    },
  };
  await expect(
    saveImage(t.db, failing, { id: "s3", userId: adminId, fileName: "s3.png" }, png([1])),
  ).rejects.toThrow("s3 down");
  const { rows } = await t.pool.query("select count(*)::int as n from image where id = $1", ["s3"]);
  expect(rows[0].n).toBe(0);
});

test("removeImage deletes rows and all objects including derivatives", async () => {
  const blob = createMemoryBlobStore();
  await saveImage(t.db, blob, { id: "r1", userId: adminId, fileName: "r1.png" }, png([1]), png([2]));
  await insertDerivative(t.db, "r1", "dk", "image/webp");
  await blob.put("r1/d/dk", Buffer.from([3]), "image/webp");

  expect(await removeImage(t.db, blob, "r1", adminId)).toBe(true);
  expect(await blob.head("r1/master")).toBe(null);
  expect(await blob.head("r1/original")).toBe(null);
  expect(await blob.head("r1/d/dk")).toBe(null);
});

test("removeImage returns false and touches no objects for another owner", async () => {
  const blob = createMemoryBlobStore();
  await saveImage(t.db, blob, { id: "r2", userId: adminId, fileName: "r2.png" }, png([1]));
  expect(await removeImage(t.db, blob, "r2", "00000000-0000-0000-0000-000000000000")).toBe(false);
  expect(await blob.head("r2/master")).toEqual({ size: 1 });
});

test("removeImage still succeeds when blob.delete fails", async () => {
  const base = createMemoryBlobStore();
  await saveImage(t.db, base, { id: "r3", userId: adminId, fileName: "r3.png" }, png([1]));
  const failing: BlobStore = {
    ...base,
    delete: async () => {
      throw new Error("s3 down");
    },
  };
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await removeImage(t.db, failing, "r3", adminId)).toBe(true);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
  const { rows } = await t.pool.query("select count(*)::int as n from image where id = $1", ["r3"]);
  expect(rows[0].n).toBe(0);
});
