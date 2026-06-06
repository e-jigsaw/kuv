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

test("list returns own images newest first with links", async () => {
  // 一意な画像を 2 枚アップロード
  const buf1 = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
  const buf2 = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 40, g: 50, b: 60 } },
  })
    .webp()
    .toBuffer();

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

  const res = await app.request("/api/image/list", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const { images } = (await res.json()) as {
    images: Array<{
      id: string;
      file_name: string;
      created: string;
      master_filetype: string;
      links: { view: string; direct: string };
    }>;
  };

  // このテストで上げた 2 枚が新しい順に並ぶ（他テストの画像も混ざるので相対順で見る)
  const i1 = images.findIndex((im) => im.id === id1);
  const i2 = images.findIndex((im) => im.id === id2);
  expect(i1).toBeGreaterThanOrEqual(0);
  expect(i2).toBeGreaterThanOrEqual(0);
  expect(i2).toBeLessThan(i1); // 後から上げた id2 が先頭側

  const im2 = images[i2]!;
  expect(im2.file_name).toBe("second.webp");
  expect(im2.master_filetype).toBe("image/webp");
  expect(im2.links.direct).toBe(`/i/${id2}.webp`);
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
