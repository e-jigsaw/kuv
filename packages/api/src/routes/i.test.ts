import type { Hono } from "hono";
import sharp from "sharp";
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

async function upload(buf: Buffer, name: string, type: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new File([buf], name, { type }));
  const res = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: fd,
  });
  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: string };
  return id;
}

test("serving without auth returns 401", async () => {
  const res = await app.request("/i/whatever");
  expect(res.status).toBe(401);
});

test("serves the master verbatim with content-type and cache headers", async () => {
  const id = await upload(await fixture("red.png"), "red.png", "image/png");

  const res = await app.request(`/i/${id}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(res.headers.get("cache-control")).toBe(
    "private, max-age=31536000, immutable",
  );
  expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");

  // master の bytes と一致（DB に入っている master を直接比較）
  const { rows } = await tdb.pool.query(
    "select data from image_file where image_id = $1 and variant = 'master'",
    [id],
  );
  const body = Buffer.from(await res.arrayBuffer());
  expect(Buffer.compare(body, Buffer.from(rows[0].data))).toBe(0);
});

test("same-format ext also serves the master without creating a derivative", async () => {
  const id = await upload(await fixture("red.png"), "red.png", "image/png");
  const res = await app.request(`/i/${id}.png`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  const { rows } = await tdb.pool.query(
    "select count(*)::int as n from image_derivative where image_id = $1",
    [id],
  );
  expect(rows[0].n).toBe(0);
});

test("converts to a requested format and caches the derivative", async () => {
  const id = await upload(await fixture("red.png"), "red.png", "image/png");

  const res = await app.request(`/i/${id}.webp`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/webp");
  const body = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(body).metadata();
  expect(meta.format).toBe("webp");

  // derivative がキャッシュされている
  const { rows } = await tdb.pool.query(
    "select count(*)::int as n from image_derivative where image_id = $1",
    [id],
  );
  expect(rows[0].n).toBe(1);
});

test("a second request is served from the cache (no reconversion)", async () => {
  const id = await upload(await fixture("still.webp"), "s.webp", "image/webp");

  const first = await app.request(`/i/${id}.png`, { headers: { Cookie: cookie } });
  expect(first.status).toBe(200);

  // キャッシュ行の data を既知のバイト列に書き換える。
  // 2回目のレスポンスがこのバイト列なら、変換せずキャッシュから返した証明になる。
  const sentinel = Buffer.from("sentinel-bytes");
  await tdb.pool.query(
    "update image_derivative set data = $1 where image_id = $2",
    [sentinel, id],
  );

  const second = await app.request(`/i/${id}.png`, { headers: { Cookie: cookie } });
  expect(second.status).toBe(200);
  const body = Buffer.from(await second.arrayBuffer());
  expect(Buffer.compare(body, sentinel)).toBe(0);
});

test("concurrent conversion requests produce exactly one derivative row", async () => {
  const id = await upload(await fixture("anim.gif"), "a.gif", "image/gif");

  const reqs = Array.from({ length: 4 }, () =>
    app.request(`/i/${id}.webp`, { headers: { Cookie: cookie } }),
  );
  const results = await Promise.all(reqs);
  for (const r of results) expect(r.status).toBe(200);

  const { rows } = await tdb.pool.query(
    "select count(*)::int as n from image_derivative where image_id = $1",
    [id],
  );
  expect(rows[0].n).toBe(1);
});

test("keeps animation frames when converting animated webp to gif", async () => {
  const id = await upload(await fixture("anim.webp"), "a.webp", "image/webp");
  const res = await app.request(`/i/${id}.gif`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const body = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(body, { animated: true }).metadata();
  expect(meta.format).toBe("gif");
  expect(meta.pages).toBe(2);
});

test("missing id returns 404", async () => {
  const res = await app.request("/i/0000000000000000000000000000000000000000000000000000000000000000", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(404);
});

test("unknown extension returns 404", async () => {
  const id = await upload(await fixture("red.png"), "red.png", "image/png");
  const res = await app.request(`/i/${id}.svg`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(404);
});
