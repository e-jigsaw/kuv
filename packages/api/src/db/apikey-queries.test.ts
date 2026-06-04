import { afterAll, beforeAll, expect, test } from "vitest";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import { createApikey, deleteApikey, listApikeys } from "./apikey-queries";

let t: TestDb;
let adminId: string;

beforeAll(async () => {
  t = await startTestDb();
  adminId = await seedAdmin(t.db, "admin", "hash");
});

afterAll(async () => {
  await t.teardown();
});

test("createApikey persists and returns the row", async () => {
  const row = await createApikey(t.db, adminId, "sharex", "key-abc");
  expect(row).toMatchObject({ name: "sharex", key: "key-abc", lastUsed: null });
  expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(row.created).toBeInstanceOf(Date);
});

test("listApikeys returns own keys newest first", async () => {
  await new Promise((r) => setTimeout(r, 20));
  await createApikey(t.db, adminId, "second", "key-def");
  const rows = await listApikeys(t.db, adminId);
  expect(rows.map((r) => r.name)).toEqual(["second", "sharex"]);
});

test("deleteApikey removes only the owner's key", async () => {
  const row = await createApikey(t.db, adminId, "doomed", "key-ghi");
  // 別ユーザーでは消えない
  expect(
    await deleteApikey(t.db, row.id, "00000000-0000-0000-0000-000000000000"),
  ).toBe(false);
  // 所有者なら消える
  expect(await deleteApikey(t.db, row.id, adminId)).toBe(true);
  const rows = await listApikeys(t.db, adminId);
  expect(rows.find((r) => r.id === row.id)).toBeUndefined();
});
