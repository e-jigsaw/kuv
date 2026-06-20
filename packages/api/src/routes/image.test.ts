import type { Hono } from "hono";
import { afterAll, beforeAll, expect, test } from "vitest";
import sharp from "sharp";
import { settings } from "@kuv/shared";
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
  const j2 = (await second.json()) as {
    id: string;
    links: { view: string; direct: string };
  };
  expect(j2.id).toBe(j1.id);
  // dedupe 応答でも master の実形式で direct リンクが組まれる
  expect(j2.links.direct).toBe(`/i/${j1.id}.webp`);
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

test("delete without auth returns 401", async () => {
  const res = await app.request("/api/image/whatever", { method: "DELETE" });
  expect(res.status).toBe(401);
});

test("delete removes an uploaded image", async () => {
  // 他テストと bytes が被らないよう sharp で専用の青い 8x8 PNG を生成する
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();
  const up = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf, "blue.png", "image/png"),
  });
  expect(up.status).toBe(200);
  const { id } = (await up.json()) as { id: string };

  const del = await app.request(`/api/image/${id}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  expect(del.status).toBe(200);

  const { rows } = await tdb.pool.query(
    "select count(*)::int as n from image where id = $1",
    [id],
  );
  expect(rows[0].n).toBe(0);
});

test("deleting a missing image returns 404", async () => {
  const res = await app.request("/api/image/does-not-exist", {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(404);
});

test("list without auth returns 401", async () => {
  const res = await app.request("/api/image/list");
  expect(res.status).toBe(401);
});

test("list returns paginated images with total/page/pageSize", async () => {
  const buf1 = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 11, g: 21, b: 31 } },
  }).png().toBuffer();
  const buf2 = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 41, g: 51, b: 61 } },
  }).webp().toBuffer();

  const up1 = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf1, "first.png", "image/png"),
  });
  const { id: id1 } = (await up1.json()) as { id: string };
  const up2 = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf2, "second.webp", "image/webp"),
  });
  const { id: id2 } = (await up2.json()) as { id: string };

  const res = await app.request("/api/image/list", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    images: Array<{ id: string; file_name: string; master_filetype: string; links: { direct: string } }>;
    total: number;
    page: number;
    pageSize: number;
  };

  expect(body.page).toBe(1);
  expect(body.pageSize).toBe(24);
  expect(body.total).toBeGreaterThanOrEqual(2);

  const i1 = body.images.findIndex((im) => im.id === id1);
  const i2 = body.images.findIndex((im) => im.id === id2);
  expect(i1).toBeGreaterThanOrEqual(0);
  expect(i2).toBeGreaterThanOrEqual(0);
  expect(i2).toBeLessThan(i1);
  expect(body.images[i2]!.master_filetype).toBe("image/webp");
  expect(body.images[i2]!.links.direct).toBe(`/i/${id2}.webp`);
});

test("list clamps a bogus page to 1", async () => {
  const res = await app.request("/api/image/list?page=-3", { headers: { Cookie: cookie } });
  const body = (await res.json()) as { page: number };
  expect(body.page).toBe(1);
});

test("list page past the end returns empty images with full total", async () => {
  const res = await app.request("/api/image/list?page=9999", { headers: { Cookie: cookie } });
  const body = (await res.json()) as { images: unknown[]; total: number; page: number };
  expect(body.page).toBe(9999);
  expect(body.images).toEqual([]);
  expect(body.total).toBeGreaterThanOrEqual(0);
});

test("upload stores original too when keep_original is on", async () => {
  await tdb.db.insert(settings).values({ id: 1, keepOriginal: true });
  try {
    const buf = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const res = await app.request("/api/image", {
      method: "POST",
      headers: { Cookie: cookie },
      body: form(buf, "cyan.png", "image/png"),
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };

    const { rows } = await tdb.pool.query(
      "select variant from image_file where image_id = $1 order by variant",
      [id],
    );
    expect(rows.map((r) => r.variant)).toEqual(["master", "original"]);
  } finally {
    await tdb.db.delete(settings);
  }
});

test("get one without auth returns 401", async () => {
  const res = await app.request("/api/image/whatever");
  expect(res.status).toBe(401);
});

test("get one returns meta for an own image", async () => {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 7, g: 8, b: 9 } },
  })
    .png()
    .toBuffer();
  const up = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf, "meta.png", "image/png"),
  });
  const { id } = (await up.json()) as { id: string };

  const res = await app.request(`/api/image/${id}`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    id: string;
    file_name: string;
    created: string;
    master_filetype: string;
    links: { view: string; direct: string };
  };
  expect(json.id).toBe(id);
  expect(json.file_name).toBe("meta.png");
  expect(json.master_filetype).toBe("image/png");
  expect(json.links.direct).toBe(`/i/${id}.png`);
  expect(typeof json.created).toBe("string");
});

test("get one returns 404 for an unknown id", async () => {
  const res = await app.request("/api/image/does-not-exist", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(404);
});
