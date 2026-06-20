import { settings } from "@kuv/shared";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import {
  deleteImage,
  findImageById,
  getDerivative,
  getImageFile,
  getSettings,
  insertDerivative,
  insertImage,
  listImages,
  updateSettings,
} from "./image-queries";

let t: TestDb;
let adminId: string;

beforeAll(async () => {
  t = await startTestDb();
  adminId = await seedAdmin(t.db, "admin", "hash");
});

afterAll(async () => {
  await t.teardown();
});

const master = { filetype: "image/png", data: Buffer.from([1, 2, 3]) } as const;

test("findImageById returns null when absent", async () => {
  expect(await findImageById(t.db, "missing")).toBe(null);
});

test("insertImage then findImageById round-trips metadata", async () => {
  await insertImage(
    t.db,
    { id: "img-a", userId: adminId, fileName: "a.png" },
    master,
  );
  const row = await findImageById(t.db, "img-a");
  expect(row).toEqual({
    id: "img-a",
    userId: adminId,
    fileName: "a.png",
    masterFiletype: "image/png",
  });
});

test("insertImage with original stores both image_file rows", async () => {
  await insertImage(
    t.db,
    { id: "img-b", userId: adminId, fileName: "b.png" },
    master,
    { filetype: "image/png", data: Buffer.from([9]) },
  );
  const { rows } = await t.pool.query(
    "select variant from image_file where image_id = $1 order by variant",
    ["img-b"],
  );
  expect(rows.map((r) => r.variant)).toEqual(["master", "original"]);
  const { rows: fileRows } = await t.pool.query(
    "select data from image_file where image_id = $1 and variant = 'master'",
    ["img-b"],
  );
  expect(Buffer.from(fileRows[0].data)).toEqual(Buffer.from([1, 2, 3]));
});

test("getSettings defaults keepOriginal to false when no row", async () => {
  expect(await getSettings(t.db)).toEqual({ keepOriginal: false });
});

test("getSettings reads keep_original from the settings row", async () => {
  await t.db.insert(settings).values({ id: 1, keepOriginal: true });
  expect(await getSettings(t.db)).toEqual({ keepOriginal: true });
  await t.db.delete(settings);
});

test("deleteImage removes only the owner's image and cascades files", async () => {
  await insertImage(
    t.db,
    { id: "img-c", userId: adminId, fileName: "c.png" },
    master,
  );
  // 別ユーザー id では消えない
  expect(await deleteImage(t.db, "img-c", "00000000-0000-0000-0000-000000000000")).toBe(false);
  // 所有者なら消える
  expect(await deleteImage(t.db, "img-c", adminId)).toBe(true);
  expect(await findImageById(t.db, "img-c")).toBe(null);
  const { rows } = await t.pool.query(
    "select count(*)::int as n from image_file where image_id = $1",
    ["img-c"],
  );
  expect(rows[0].n).toBe(0);
});

test("getImageFile returns the master bytes and filetype", async () => {
  await insertImage(
    t.db,
    { id: "img-f", userId: adminId, fileName: "f.png" },
    { filetype: "image/png", data: Buffer.from([7, 8, 9]) },
  );
  const f = await getImageFile(t.db, "img-f", "master");
  expect(f).not.toBe(null);
  expect(f!.filetype).toBe("image/png");
  expect(Buffer.compare(Buffer.from(f!.data), Buffer.from([7, 8, 9]))).toBe(0);
});

test("getImageFile returns null for a missing variant", async () => {
  expect(await getImageFile(t.db, "img-f", "original")).toBe(null);
});

test("insertDerivative then getDerivative round-trips and bumps last_read", async () => {
  await insertDerivative(t.db, "img-f", "key-1", "image/webp", Buffer.from([1]));

  const before = await t.pool.query(
    "select last_read from image_derivative where image_id = $1 and key = $2",
    ["img-f", "key-1"],
  );

  // last_read の差が出るよう少し待つ
  await new Promise((r) => setTimeout(r, 20));

  const d = await getDerivative(t.db, "img-f", "key-1");
  expect(d).not.toBe(null);
  expect(d!.filetype).toBe("image/webp");
  expect(Buffer.compare(Buffer.from(d!.data), Buffer.from([1]))).toBe(0);

  const after = await t.pool.query(
    "select last_read from image_derivative where image_id = $1 and key = $2",
    ["img-f", "key-1"],
  );
  expect(new Date(after.rows[0].last_read).getTime()).toBeGreaterThan(
    new Date(before.rows[0].last_read).getTime(),
  );
});

test("getDerivative returns null on miss", async () => {
  expect(await getDerivative(t.db, "img-f", "no-such-key")).toBe(null);
});

test("insertDerivative ignores a duplicate (image_id, key)", async () => {
  await insertDerivative(t.db, "img-f", "key-1", "image/webp", Buffer.from([9, 9]));
  const { rows } = await t.pool.query(
    "select count(*)::int as n from image_derivative where image_id = $1 and key = $2",
    ["img-f", "key-1"],
  );
  expect(rows[0].n).toBe(1);
  // 先勝ち: data は最初の [1] のまま
  const d = await getDerivative(t.db, "img-f", "key-1");
  expect(Buffer.compare(Buffer.from(d!.data), Buffer.from([1]))).toBe(0);
});

test("listImages paginates newest first and returns total", async () => {
  // 専用ユーザーで 3 枚（created の差を作る）
  const uid = await seedAdmin(t.db, "pager", "hash");
  for (const n of ["p1", "p2", "p3"]) {
    await insertImage(
      t.db,
      { id: n, userId: uid, fileName: `${n}.png` },
      { filetype: "image/png", data: Buffer.from([1]) },
    );
    await new Promise((r) => setTimeout(r, 10));
  }

  const page1 = await listImages(t.db, uid, { limit: 2, offset: 0 });
  expect(page1.total).toBe(3);
  expect(page1.rows.map((r) => r.id)).toEqual(["p3", "p2"]);
  expect(page1.rows[0]).toMatchObject({ fileName: "p3.png", masterFiletype: "image/png" });
  expect(page1.rows[0]!.created).toBeInstanceOf(Date);

  const page2 = await listImages(t.db, uid, { limit: 2, offset: 2 });
  expect(page2.total).toBe(3);
  expect(page2.rows.map((r) => r.id)).toEqual(["p1"]);
});

test("listImages returns empty rows with correct total past the end", async () => {
  const uid = await seedAdmin(t.db, "pager2", "hash");
  await insertImage(
    t.db,
    { id: "q1", userId: uid, fileName: "q1.png" },
    { filetype: "image/png", data: Buffer.from([1]) },
  );
  const beyond = await listImages(t.db, uid, { limit: 24, offset: 24 });
  expect(beyond.rows).toEqual([]);
  expect(beyond.total).toBe(1);
});

test("listImages returns empty rows and total 0 for a user with no images", async () => {
  const res = await listImages(t.db, "00000000-0000-0000-0000-000000000000", {
    limit: 24,
    offset: 0,
  });
  expect(res.rows).toEqual([]);
  expect(res.total).toBe(0);
});

test("updateSettings upserts the single settings row", async () => {
  // 行が無い状態から PUT 相当
  await updateSettings(t.db, { keepOriginal: true });
  expect(await getSettings(t.db)).toEqual({ keepOriginal: true });
  // 再度 upsert（冪等）
  await updateSettings(t.db, { keepOriginal: false });
  expect(await getSettings(t.db)).toEqual({ keepOriginal: false });
  // 後始末（他テストへの影響防止）
  await t.db.delete(settings);
});
