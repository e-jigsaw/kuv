import type { Hono } from "hono";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createApp } from "../app";
import { hashPassword } from "../auth/password";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import type { AppBindings } from "../types";

let tdb: TestDb;
let app: Hono<AppBindings>;
let cookie: string;

beforeAll(async () => {
  process.env.PICSUR_JWT_SECRET = "test-secret";
  tdb = await startTestDb();
  await seedAdmin(tdb.db, "admin", await hashPassword("hunter2"));
  app = createApp(tdb.db);

  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

afterAll(async () => {
  await tdb.teardown();
});

test("get settings without auth returns 401", async () => {
  const res = await app.request("/api/settings");
  expect(res.status).toBe(401);
});

test("get settings defaults keep_original to false", async () => {
  const res = await app.request("/api/settings", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ keep_original: false });
});

test("put settings persists and get reflects it", async () => {
  const put = await app.request("/api/settings", {
    method: "PUT",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ keep_original: true }),
  });
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ keep_original: true });

  const get = await app.request("/api/settings", {
    headers: { Cookie: cookie },
  });
  expect(await get.json()).toEqual({ keep_original: true });

  // 再 PUT（upsert 冪等）
  const put2 = await app.request("/api/settings", {
    method: "PUT",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ keep_original: false }),
  });
  expect(put2.status).toBe(200);
  const get2 = await app.request("/api/settings", {
    headers: { Cookie: cookie },
  });
  expect(await get2.json()).toEqual({ keep_original: false });
});

test("put settings with non-boolean returns 400", async () => {
  const res = await app.request("/api/settings", {
    method: "PUT",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ keep_original: "yes" }),
  });
  expect(res.status).toBe(400);
});
