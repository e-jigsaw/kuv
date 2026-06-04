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

interface ApikeyJson {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string | null;
}

test("apikey routes without auth return 401", async () => {
  expect((await app.request("/api/apikey")).status).toBe(401);
  expect(
    (await app.request("/api/apikey", { method: "POST" })).status,
  ).toBe(401);
  expect(
    (await app.request("/api/apikey/x", { method: "DELETE" })).status,
  ).toBe(401);
});

test("create issues a 32-char alphanumeric key with default dated name", async () => {
  const res = await app.request("/api/apikey", {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  const { apikey } = (await res.json()) as { apikey: ApikeyJson };
  expect(apikey.key).toMatch(/^[A-Za-z0-9]{32}$/);
  // 旧実装と同じ YYYY-MM-DD_<n> デフォルト名
  expect(apikey.name).toMatch(/^\d{4}-\d{2}-\d{2}_\d+$/);
});

test("create accepts a custom name and the key authenticates via /api/auth/me", async () => {
  const res = await app.request("/api/apikey", {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "sharex" }),
  });
  const { apikey } = (await res.json()) as { apikey: ApikeyJson };
  expect(apikey.name).toBe("sharex");

  // 発行した key で認証が通る（authMiddleware 連携の end-to-end）
  const me = await app.request("/api/auth/me", {
    headers: { Authorization: `Api-Key ${apikey.key}` },
  });
  expect(me.status).toBe(200);
  const json = (await me.json()) as { user: { username: string } };
  expect(json.user.username).toBe("admin");
});

test("list returns issued keys with plaintext key", async () => {
  const res = await app.request("/api/apikey", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const { apikeys } = (await res.json()) as { apikeys: ApikeyJson[] };
  expect(apikeys.length).toBeGreaterThanOrEqual(2);
  const sharex = apikeys.find((k) => k.name === "sharex");
  expect(sharex).toBeDefined();
  expect(sharex!.key).toMatch(/^[A-Za-z0-9]{32}$/);
});

test("delete revokes the key and it no longer authenticates", async () => {
  const created = await app.request("/api/apikey", {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "doomed" }),
  });
  const { apikey } = (await created.json()) as { apikey: ApikeyJson };

  const del = await app.request(`/api/apikey/${apikey.id}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  expect(del.status).toBe(200);

  // 失効後はその key で認証できない
  const me = await app.request("/api/auth/me", {
    headers: { Authorization: `Api-Key ${apikey.key}` },
  });
  expect(me.status).toBe(401);
});

test("delete with a non-uuid id returns 404 (no pg error)", async () => {
  const res = await app.request("/api/apikey/not-a-uuid", {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(404);
});

test("delete with a missing uuid returns 404", async () => {
  const res = await app.request(
    "/api/apikey/00000000-0000-0000-0000-000000000000",
    { method: "DELETE", headers: { Cookie: cookie } },
  );
  expect(res.status).toBe(404);
});
