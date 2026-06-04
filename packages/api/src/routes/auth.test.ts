import { apikey } from "@picsur/shared";
import type { Hono } from "hono";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createApp } from "../app";
import { hashPassword } from "../auth/password";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import type { AppBindings } from "../types";

let tdb: TestDb;
let app: Hono<AppBindings>;

beforeAll(async () => {
  process.env.PICSUR_JWT_SECRET = "test-secret";
  tdb = await startTestDb();

  const hash = await hashPassword("hunter2");
  const adminId = await seedAdmin(tdb.db, "admin", hash);
  // apikey を1つ仕込む
  await tdb.db.insert(apikey).values({
    key: "testkey123",
    userId: adminId,
    name: "test",
  });

  app = createApp(tdb.db);
});

afterAll(async () => {
  await tdb.teardown();
});

test("login with correct credentials sets a cookie and returns user", async () => {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("picsur_jwt=");
  const json = (await res.json()) as { user: { username: string } };
  expect(json.user.username).toBe("admin");
});

test("login with wrong password returns 401", async () => {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  expect(res.status).toBe(401);
});

test("me without auth returns 401", async () => {
  const res = await app.request("/api/auth/me");
  expect(res.status).toBe(401);
});

test("me with apikey query returns the admin user", async () => {
  const res = await app.request("/api/auth/me?key=testkey123");
  expect(res.status).toBe(200);
  const json = (await res.json()) as { user: { username: string } };
  expect(json.user.username).toBe("admin");
});

test("me with apikey header returns the admin user", async () => {
  const res = await app.request("/api/auth/me", {
    headers: { Authorization: "Api-Key testkey123" },
  });
  expect(res.status).toBe(200);
});

test("me with the login cookie returns the admin user", async () => {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const res = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { user: { username: string } };
  expect(json.user.username).toBe("admin");
});

test("password change without auth returns 401", async () => {
  const res = await app.request("/api/auth/password", { method: "POST" });
  expect(res.status).toBe(401);
});

test("password change with wrong current password returns 401", async () => {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

  const res = await app.request("/api/auth/password", {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ current: "wrong", new: "next-password" }),
  });
  expect(res.status).toBe(401);
});

test("password change with empty new password returns 400", async () => {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

  const res = await app.request("/api/auth/password", {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ current: "hunter2", new: "" }),
  });
  expect(res.status).toBe(400);
});

test("password change rotates credentials (old fails, new works)", async () => {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

  const res = await app.request("/api/auth/password", {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ current: "hunter2", new: "correct horse" }),
  });
  expect(res.status).toBe(200);

  // 旧パスワードでは login 不可
  const oldLogin = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  expect(oldLogin.status).toBe(401);

  // 新パスワードで login 可
  const newLogin = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct horse" }),
  });
  expect(newLogin.status).toBe(200);

  // 後始末: 他テストが "hunter2" 前提なので戻す
  const cookie2 = newLogin.headers.get("set-cookie")!.split(";")[0]!;
  const restore = await app.request("/api/auth/password", {
    method: "POST",
    headers: { Cookie: cookie2, "content-type": "application/json" },
    body: JSON.stringify({ current: "correct horse", new: "hunter2" }),
  });
  expect(restore.status).toBe(200);
});
