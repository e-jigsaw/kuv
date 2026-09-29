import type { Hono } from "hono";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../app";
import { hashPassword } from "../auth/password";
import { fixture } from "../test/fixtures";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import type { AppBindings } from "../types";

let tdb: TestDb;
let app: Hono<AppBindings>;
let cookie: string;

beforeAll(async () => {
  process.env.KUV_JWT_SECRET = "test-secret";
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

test("empty id (/i/.png) returns 404", async () => {
  const res = await app.request("/i/.png", { headers: { Cookie: cookie } });
  expect(res.status).toBe(404);
});

test("empty extension (/i/<id>.) returns 404", async () => {
  const id = await upload(await fixture("red.png"), "red.png", "image/png");
  const res = await app.request(`/i/${id}.`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(404);
});

test("multiple dots resolve to an unknown extension and return 404", async () => {
  const res = await app.request("/i/a.b.c", { headers: { Cookie: cookie } });
  expect(res.status).toBe(404);
});

describe("variant=original", () => {
  async function setKeepOriginal(on: boolean) {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ keep_original: on }),
    });
    expect(res.status).toBe(200);
  }

  // 他テストで上げた fixture と dedupe されないよう、テストごとに固有の画像を作る
  function uniqueImage(format: "webp" | "gif", seed: number): Promise<Buffer> {
    return sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: seed, g: 7, b: 9 } },
    })
      .toFormat(format)
      .toBuffer();
  }

  test("serves the stored original bytes (sha256 == id)", async () => {
    await setKeepOriginal(true);
    const id = await upload(await uniqueImage("webp", 1), "u.webp", "image/webp");

    const res = await app.request(`/i/${id}?variant=original`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const body = Buffer.from(await res.arrayBuffer());
    expect(createHash("sha256").update(body).digest("hex")).toBe(id);
    await setKeepOriginal(false);
  });

  test("same-format ext is allowed", async () => {
    await setKeepOriginal(true);
    const id = await upload(await uniqueImage("gif", 2), "u.gif", "image/gif");
    const res = await app.request(`/i/${id}.gif?variant=original`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(createHash("sha256").update(body).digest("hex")).toBe(id);
    await setKeepOriginal(false);
  });

  test("different-format ext returns 404 (no conversion)", async () => {
    await setKeepOriginal(true);
    const id = await upload(await uniqueImage("webp", 3), "u.webp", "image/webp");
    const res = await app.request(`/i/${id}.png?variant=original`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
    await setKeepOriginal(false);
  });

  test("image without an original returns 404 (no master fallback)", async () => {
    const id = await upload(await fixture("red.png"), "red.png", "image/png");
    const { rows } = await tdb.pool.query(
      "select count(*)::int as n from image_file where image_id = $1 and variant = 'original'",
      [id],
    );
    expect(rows[0].n).toBe(0);
    const res = await app.request(`/i/${id}?variant=original`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  test("without auth returns 401", async () => {
    const res = await app.request("/i/whatever?variant=original");
    expect(res.status).toBe(401);
  });

  test("unknown variant returns 400", async () => {
    const res = await app.request("/i/whatever?variant=foo", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });
});
