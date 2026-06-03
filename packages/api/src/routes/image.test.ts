import type { Hono } from "hono";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createApp } from "../app";
import { hashPassword } from "../auth/password";
import { fixture } from "../test/fixtures";
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
  cookie = await loginCookie();
});

afterAll(async () => {
  await tdb.teardown();
});

async function loginCookie(): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function form(buf: Buffer, name: string, type: string): FormData {
  const fd = new FormData();
  fd.append("file", new File([buf], name, { type }));
  return fd;
}

test("upload without auth returns 401", async () => {
  const res = await app.request("/api/image", {
    method: "POST",
    body: form(await fixture("red.png"), "red.png", "image/png"),
  });
  expect(res.status).toBe(401);
});

test("upload a png returns id and links", async () => {
  const buf = await fixture("red.png");
  const res = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf, "red.png", "image/png"),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    id: string;
    file_name: string;
    links: { view: string; direct: string };
  };
  expect(json.id).toMatch(/^[0-9a-f]{64}$/);
  expect(json.file_name).toBe("red.png");
  expect(json.links.view).toBe(`/i/${json.id}`);
  expect(json.links.direct).toBe(`/i/${json.id}.png`);
});

test("uploading the same bytes twice dedupes to the same id", async () => {
  const buf = await fixture("still.webp");
  const first = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf, "a.webp", "image/webp"),
  });
  const second = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf, "b.webp", "image/webp"),
  });
  const j1 = (await first.json()) as { id: string };
  const j2 = (await second.json()) as { id: string };
  expect(j2.id).toBe(j1.id);
  // 行は1つだけ
  const { rows } = await tdb.pool.query(
    "select count(*)::int as n from image where id = $1",
    [j1.id],
  );
  expect(rows[0].n).toBe(1);
});

test("uploading a non-image returns 415", async () => {
  const res = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(await fixture("notimage.txt"), "x.txt", "text/plain"),
  });
  expect(res.status).toBe(415);
});
