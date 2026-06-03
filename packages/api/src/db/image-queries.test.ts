import { settings } from "@picsur/shared";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import {
  deleteImage,
  findImageById,
  getSettings,
  insertImage,
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
  expect(row).toEqual({ id: "img-a", userId: adminId, fileName: "a.png" });
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
});

test("getSettings defaults keepOriginal to false when no row", async () => {
  expect(await getSettings(t.db)).toEqual({ keepOriginal: false });
});

test("getSettings reads keep_original from the settings row", async () => {
  await t.db.insert(settings).values({ id: 1, keepOriginal: true });
  expect(await getSettings(t.db)).toEqual({ keepOriginal: true });
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
