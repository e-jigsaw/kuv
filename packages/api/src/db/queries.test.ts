import { apikey } from "@kuv/shared";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import { getUserById, getUserByUsername, resolveApikey, updatePassword } from "./queries";

let t: TestDb;
let adminId: string;

beforeAll(async () => {
  t = await startTestDb();
  adminId = await seedAdmin(t.db, "admin", "hash-value");
});

afterAll(async () => {
  await t.teardown();
});

test("getUserByUsername returns the user with password hash", async () => {
  const u = await getUserByUsername(t.db, "admin");
  expect(u).toMatchObject({ id: adminId, username: "admin", password: "hash-value" });
});

test("getUserByUsername returns null for an unknown username", async () => {
  expect(await getUserByUsername(t.db, "nobody")).toBe(null);
});

test("getUserById returns the user without password", async () => {
  const u = await getUserById(t.db, adminId);
  expect(u).toEqual({ id: adminId, username: "admin" });
});

test("getUserById returns null for an unknown id", async () => {
  expect(
    await getUserById(t.db, "00000000-0000-0000-0000-000000000000"),
  ).toBe(null);
});

test("resolveApikey resolves the owning user and bumps last_used", async () => {
  await t.db
    .insert(apikey)
    .values({ key: "secret-key", userId: adminId, name: "test" });

  const u = await resolveApikey(t.db, "secret-key");
  expect(u).toEqual({ id: adminId, username: "admin" });

  const [row] = await t.pool.query(
    "select last_used from apikey where key = $1",
    ["secret-key"],
  ).then((r) => r.rows);
  expect(row.last_used).not.toBe(null);
});

test("resolveApikey returns null for an unknown key", async () => {
  expect(await resolveApikey(t.db, "no-such-key")).toBe(null);
});

test("updatePassword replaces the stored hash", async () => {
  await updatePassword(t.db, adminId, "new-hash");
  const u = await getUserByUsername(t.db, "admin");
  expect(u!.password).toBe("new-hash");
  // Restore original hash to avoid test order dependencies
  await updatePassword(t.db, adminId, "hash-value");
});
