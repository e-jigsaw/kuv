# Picsur Settings / Apikey / Password / Image List Implementation Plan (Plan 3c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** api の残りルート群 — `GET /api/image/list` / `GET・PUT /api/settings` / apikey CRUD / `POST /api/auth/password` — を実装し Phase 3（バックエンド）を完結させる。あわせて EXT マップの重複を shared に統合する。

**Architecture:** 既存パターン踏襲 — DB I/O は `db/*-queries.ts`、HTTP 配線は `routes/*`、純ユーティリティは `util/`。apikey の key は旧実装互換の 32 文字ランダム英数字・平文保存（既存キーを migration で引き継ぐため）。全ルート `requireAuth`。

**Tech Stack:** Hono / Drizzle / pg / bcrypt / Vitest + testcontainers。設計は `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「Plan 3c の決定事項」節。

---

## File Structure

- Modify: `packages/shared/src/constants.ts` — `MIME_TO_EXT` / `EXT_TO_MIME` を追加
- Modify: `packages/shared/src/constants.test.ts` — 対応テスト
- Modify: `packages/api/src/routes/image.ts` — ローカル `EXT` を shared に移行 + `GET /list` 追加
- Modify: `packages/api/src/routes/i.ts` — ローカル `EXT_TO_MIME` を shared に移行
- Create: `packages/api/src/util/random.ts` — `generateRandomString`（旧 shared から移植）
- Modify: `packages/api/src/db/image-queries.ts` — `listImages` / `updateSettings` 追加
- Create: `packages/api/src/db/apikey-queries.ts` — `listApikeys` / `createApikey` / `deleteApikey`
- Modify: `packages/api/src/db/queries.ts` — `updatePassword` 追加
- Create: `packages/api/src/routes/settings.ts` / `packages/api/src/routes/apikey.ts`
- Modify: `packages/api/src/routes/auth.ts` — `POST /password` 追加
- Modify: `packages/api/src/app.ts` — `/api/settings` / `/api/apikey` mount

---

## Task 1: EXT マップを shared に統合（TDD）

`routes/image.ts` の `EXT`（mime→ext）と `routes/i.ts` の `EXT_TO_MIME`（ext→mime）が重複定義。shared の `constants.ts` に統合する。

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/constants.test.ts`
- Modify: `packages/api/src/routes/image.ts`
- Modify: `packages/api/src/routes/i.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/shared/src/constants.test.ts` に追記**

既存テストの末尾に追加:

```ts
import { EXT_TO_MIME, MIME_TO_EXT, SUPPORTED_MIMES } from "./constants";

test("MIME_TO_EXT covers all supported mimes", () => {
  expect(MIME_TO_EXT).toEqual({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  });
});

test("EXT_TO_MIME maps serving extensions including jpeg alias", () => {
  expect(EXT_TO_MIME).toEqual({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  });
});

test("MIME_TO_EXT and EXT_TO_MIME round-trip for every supported mime", () => {
  for (const mime of SUPPORTED_MIMES) {
    expect(EXT_TO_MIME[MIME_TO_EXT[mime]]).toBe(mime);
  }
});
```

> 既存の import 文と重複する場合は 1 つの import にまとめること（`SUPPORTED_MIMES` 等は既に import されているかもしれない）。

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/shared test constants`
Expected: FAIL（`MIME_TO_EXT` / `EXT_TO_MIME` が export されていない）

- [x] **Step 3: 実装 — `packages/shared/src/constants.ts` に追記**

```ts
// 配信用拡張子マップ（routes/image の links と routes/i の ext 解決が共用）
export const MIME_TO_EXT: Record<SupportedMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const EXT_TO_MIME: Record<string, SupportedMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
```

- [x] **Step 4: shared テスト緑を確認**

Run: `pnpm --filter @picsur/shared test constants`
Expected: PASS

- [x] **Step 5: routes/image.ts をローカル `EXT` から移行**

`packages/api/src/routes/image.ts` のローカル定義:

```ts
// mime → 配信用拡張子
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
```

を削除し、import に `MIME_TO_EXT` と `SupportedMime` を追加:

```ts
import { MIME_TO_EXT, type SupportedMime } from "@picsur/shared";
```

`links` 関数を以下に変更:

```ts
function links(id: string, mime: string) {
  const ext = MIME_TO_EXT[mime as SupportedMime] ?? "bin";
  return { view: `/i/${id}`, direct: `/i/${id}.${ext}` };
}
```

- [x] **Step 6: routes/i.ts をローカル `EXT_TO_MIME` から移行**

`packages/api/src/routes/i.ts` のローカル定義:

```ts
// 配信用拡張子 → mime
const EXT_TO_MIME: Record<string, SupportedMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
```

を削除し、import を変更:

```ts
import { EXT_TO_MIME, type SupportedMime } from "@picsur/shared";
```

（`SupportedMime` が未使用になったら import から外す — `targetMime` の型注釈等で使っていれば残す）

- [x] **Step 7: 回帰確認**

Run: `pnpm --filter @picsur/api test routes && pnpm -r typecheck`
Expected: routes/image 8 + routes/i 12 テスト PASS、typecheck 全緑。

- [x] **Step 8: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/constants.test.ts packages/api/src/routes/image.ts packages/api/src/routes/i.ts
git commit -m "refactor: unify ext/mime maps in shared constants"
```

---

## Task 2: generateRandomString の移植（TDD）

apikey の key 生成用。旧 `archive/shared/src/util/random.ts` の移植（32 文字英数字、旧キー形式と互換）。

**Files:**
- Create: `packages/api/src/util/random.ts`
- Test: `packages/api/src/util/random.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/util/random.test.ts`**

```ts
import { expect, test } from "vitest";
import { generateRandomString } from "./random";

test("generates a string of the requested length", () => {
  expect(generateRandomString(32)).toHaveLength(32);
  expect(generateRandomString(8)).toHaveLength(8);
});

test("uses only alphanumeric characters", () => {
  expect(generateRandomString(64)).toMatch(/^[A-Za-z0-9]+$/);
});

test("two generations differ", () => {
  expect(generateRandomString(32)).not.toBe(generateRandomString(32));
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test util/random`
Expected: FAIL（`./random` が無い）

- [x] **Step 3: 実装 — `packages/api/src/util/random.ts`**

旧実装の `crypto.randomInt(0, len - 1)` は最後の文字が出ないオフバイワンバグなので、移植時に `crypto.randomInt(0, len)`（上限排他）へ修正する:

```ts
import { randomInt } from "node:crypto";

const CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// apikey の key 用ランダム英数字（旧 archive/shared/src/util/random.ts の移植。
// 旧版の randomInt(0, len - 1) は最終文字が出ないオフバイワンだったため上限排他に修正）
export function generateRandomString(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CHARACTERS[randomInt(0, CHARACTERS.length)];
  }
  return out;
}
```

- [x] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test util/random`
Expected: PASS（3 test）

- [x] **Step 5: Commit**

```bash
git add packages/api/src/util/random.ts packages/api/src/util/random.test.ts
git commit -m "feat(api): add alphanumeric random string util for apikeys"
```

---

## Task 3: DB クエリ追加（TDD, testcontainers）

`listImages` / `updateSettings`（image-queries.ts）、apikey 3 関数（apikey-queries.ts 新規）、`updatePassword`（queries.ts）。

**Files:**
- Modify: `packages/api/src/db/image-queries.ts`
- Modify: `packages/api/src/db/image-queries.test.ts`
- Create: `packages/api/src/db/apikey-queries.ts`
- Test: `packages/api/src/db/apikey-queries.test.ts`
- Modify: `packages/api/src/db/queries.ts`
- Modify: `packages/api/src/db/queries.test.ts`

- [x] **Step 1: 失敗するテストを書く (a) — `packages/api/src/db/image-queries.test.ts` に追記**

import に `listImages` / `updateSettings` を追加し、ファイル末尾に:

```ts
test("listImages returns own images newest first with master filetype", async () => {
  await insertImage(
    t.db,
    { id: "list-1", userId: adminId, fileName: "one.png" },
    { filetype: "image/png", data: Buffer.from([1]) },
  );
  // created の差を作る
  await new Promise((r) => setTimeout(r, 20));
  await insertImage(
    t.db,
    { id: "list-2", userId: adminId, fileName: "two.webp" },
    { filetype: "image/webp", data: Buffer.from([2]) },
  );

  const rows = await listImages(t.db, adminId);
  const listed = rows.filter((r) => r.id.startsWith("list-"));
  expect(listed.map((r) => r.id)).toEqual(["list-2", "list-1"]);
  expect(listed[0]).toMatchObject({
    id: "list-2",
    fileName: "two.webp",
    masterFiletype: "image/webp",
  });
  expect(listed[0]!.created).toBeInstanceOf(Date);
});

test("listImages returns empty array for a user with no images", async () => {
  const rows = await listImages(t.db, "00000000-0000-0000-0000-000000000000");
  expect(rows).toEqual([]);
});

test("updateSettings upserts the single settings row", async () => {
  // 行が無い状態から PUT 相当
  await updateSettings(t.db, { keepOriginal: true });
  expect(await getSettings(t.db)).toEqual({ keepOriginal: true });
  // 再度 upsert（冪等）
  await updateSettings(t.db, { keepOriginal: false });
  expect(await getSettings(t.db)).toEqual({ keepOriginal: false });
  // 後始末（他テストへの影響防止）
  await t.db.delete(settings);
});
```

- [x] **Step 2: 失敗するテストを書く (b) — `packages/api/src/db/apikey-queries.test.ts`（新規）**

```ts
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
```

- [x] **Step 3: 失敗するテストを書く (c) — `packages/api/src/db/queries.test.ts` に追記**

import に `updatePassword` を追加し、ファイル末尾に:

```ts
test("updatePassword replaces the stored hash", async () => {
  await updatePassword(t.db, adminId, "new-hash");
  const u = await getUserByUsername(t.db, "admin");
  expect(u!.password).toBe("new-hash");
});
```

> 注: このテストは同ファイルの既存テストが使う "admin" の password を書き換える。既存テストは password の値に依存していない（"hash-value" の round-trip テストは先に実行される）ため末尾追加なら安全だが、既存テストの期待値と衝突しないことを確認すること。

- [x] **Step 4: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test db/`
Expected: FAIL（`listImages` / `updateSettings` / apikey-queries モジュール / `updatePassword` が無い）

- [x] **Step 5: 実装 (a) — `packages/api/src/db/image-queries.ts` に追記**

import の `and, eq` に `desc` を追加（`import { and, desc, eq } from "drizzle-orm";`）し、ファイル末尾に:

```ts
export interface ImageListEntry {
  id: string;
  fileName: string;
  created: Date;
  masterFiletype: string;
}

// 自分の画像一覧（created desc 全件 — 自家用なのでページングは YAGNI）
export async function listImages(
  db: Db,
  userId: string,
): Promise<ImageListEntry[]> {
  return db
    .select({
      id: image.id,
      fileName: image.fileName,
      created: image.created,
      masterFiletype: imageFile.filetype,
    })
    .from(image)
    .innerJoin(
      imageFile,
      and(eq(imageFile.imageId, image.id), eq(imageFile.variant, "master")),
    )
    .where(eq(image.userId, userId))
    .orderBy(desc(image.created));
}

// settings 単一行（id=1）を upsert
export async function updateSettings(db: Db, s: Settings): Promise<void> {
  await db
    .insert(settings)
    .values({ id: 1, keepOriginal: s.keepOriginal })
    .onConflictDoUpdate({
      target: settings.id,
      set: { keepOriginal: s.keepOriginal },
    });
}
```

- [x] **Step 6: 実装 (b) — `packages/api/src/db/apikey-queries.ts`（新規）**

```ts
import { apikey } from "@picsur/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db";

export interface ApikeyEntry {
  id: string;
  name: string;
  key: string;
  created: Date;
  lastUsed: Date | null;
}

const entryColumns = {
  id: apikey.id,
  name: apikey.name,
  key: apikey.key,
  created: apikey.created,
  lastUsed: apikey.lastUsed,
};

// 自分の apikey 一覧（created desc）。key は平文保存方式（旧実装踏襲）なのでそのまま返す。
export async function listApikeys(
  db: Db,
  userId: string,
): Promise<ApikeyEntry[]> {
  return db
    .select(entryColumns)
    .from(apikey)
    .where(eq(apikey.userId, userId))
    .orderBy(desc(apikey.created));
}

export async function createApikey(
  db: Db,
  userId: string,
  name: string,
  key: string,
): Promise<ApikeyEntry> {
  const [row] = await db
    .insert(apikey)
    .values({ userId, name, key })
    .returning(entryColumns);
  return row!;
}

// 所有者一致で削除。消えたら true。
// id は UUID 文字列であること（non-UUID は pg が uuid パースエラーを throw する — 呼び出し側でガード）。
export async function deleteApikey(
  db: Db,
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(apikey)
    .where(and(eq(apikey.id, id), eq(apikey.userId, userId)))
    .returning({ id: apikey.id });
  return deleted.length > 0;
}
```

- [x] **Step 7: 実装 (c) — `packages/api/src/db/queries.ts` に追記**

```ts
// パスワード（bcrypt hash）を更新する
export async function updatePassword(
  db: Db,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(user)
    .set({ password: passwordHash })
    .where(eq(user.id, userId));
}
```

- [x] **Step 8: テスト緑を確認**

Run: `pnpm --filter @picsur/api test db/`
Expected: PASS（image-queries 14 / apikey-queries 3 / queries 7）

- [x] **Step 9: typecheck + Commit**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

```bash
git add packages/api/src/db/
git commit -m "feat(api): add list/settings/apikey/password db queries"
```

---

## Task 4: `GET /api/image/list` ルート（TDD, testcontainers）

**Files:**
- Modify: `packages/api/src/routes/image.ts`
- Modify: `packages/api/src/routes/image.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/routes/image.test.ts` 末尾に追加**

```ts
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
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test routes/image`
Expected: FAIL（`/api/image/list` が無い — POST `/` のみなので GET は 404）

- [x] **Step 3: 実装 — `packages/api/src/routes/image.ts`**

import に `listImages` を追加:

```ts
import {
  deleteImage,
  findImageById,
  getSettings,
  insertImage,
  listImages,
} from "../db/image-queries";
```

POST ルートの前（`imageRoutes.post(` の直前）に追加:

```ts
// 自分の画像一覧（要認証）。created desc 全件
imageRoutes.get("/list", requireAuth, async (c) => {
  const rows = await listImages(c.var.db, c.var.user!.id);
  return c.json({
    images: rows.map((r) => ({
      id: r.id,
      file_name: r.fileName,
      created: r.created,
      master_filetype: r.masterFiletype,
      links: links(r.id, r.masterFiletype),
    })),
  });
});
```

- [x] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test routes/image`
Expected: PASS（10 test）

- [x] **Step 5: typecheck + Commit**

Run: `pnpm --filter @picsur/api typecheck`

```bash
git add packages/api/src/routes/image.ts packages/api/src/routes/image.test.ts
git commit -m "feat(api): add GET /api/image/list"
```

---

## Task 5: settings ルート（TDD, testcontainers）

**Files:**
- Create: `packages/api/src/routes/settings.ts`
- Test: `packages/api/src/routes/settings.test.ts`
- Modify: `packages/api/src/app.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/routes/settings.test.ts`（新規）**

```ts
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
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test routes/settings`
Expected: FAIL（ルートが無く 404、または app.ts に mount が無い）

- [x] **Step 3: 実装 — `packages/api/src/routes/settings.ts`（新規）**

```ts
import { Hono } from "hono";
import { getSettings, updateSettings } from "../db/image-queries";
import { requireAuth } from "../middleware/auth";
import type { AppBindings } from "../types";

export const settingsRoutes = new Hono<AppBindings>();

// 設定取得（要認証）
settingsRoutes.get("/", requireAuth, async (c) => {
  const s = await getSettings(c.var.db);
  return c.json({ keep_original: s.keepOriginal });
});

// 設定更新（要認証）。単一行 upsert
settingsRoutes.put("/", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.keep_original !== "boolean") {
    return c.json({ error: "keep_original must be boolean" }, 400);
  }
  await updateSettings(c.var.db, { keepOriginal: body.keep_original });
  return c.json({ keep_original: body.keep_original });
});
```

- [x] **Step 4: app.ts に mount**

import 追加:

```ts
import { settingsRoutes } from "./routes/settings";
```

`createApp` 内、`app.route("/i", iRoutes);` の直後に:

```ts
  app.route("/api/settings", settingsRoutes);
```

- [x] **Step 5: テスト緑を確認 + typecheck**

Run: `pnpm --filter @picsur/api test routes/settings && pnpm --filter @picsur/api typecheck`
Expected: PASS（4 test）、typecheck エラー無し。

- [x] **Step 6: Commit**

```bash
git add packages/api/src/routes/settings.ts packages/api/src/routes/settings.test.ts packages/api/src/app.ts
git commit -m "feat(api): add GET/PUT /api/settings (keep_original)"
```

---

## Task 6: apikey ルート（TDD, testcontainers）

**Files:**
- Create: `packages/api/src/routes/apikey.ts`
- Test: `packages/api/src/routes/apikey.test.ts`
- Modify: `packages/api/src/app.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/routes/apikey.test.ts`（新規）**

```ts
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
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test routes/apikey`
Expected: FAIL（ルートが無い）

- [x] **Step 3: 実装 — `packages/api/src/routes/apikey.ts`（新規）**

```ts
import { Hono } from "hono";
import {
  createApikey,
  deleteApikey,
  listApikeys,
} from "../db/apikey-queries";
import { requireAuth } from "../middleware/auth";
import { generateRandomString } from "../util/random";
import type { AppBindings } from "../types";

export const apikeyRoutes = new Hono<AppBindings>();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 一覧（要認証）。key は平文保存方式（旧実装踏襲・既存キー互換）なので再表示する
apikeyRoutes.get("/", requireAuth, async (c) => {
  const apikeys = await listApikeys(c.var.db, c.var.user!.id);
  return c.json({ apikeys });
});

// 発行（要認証）。name 省略時は旧実装と同じ YYYY-MM-DD_<n>
apikeyRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name =
    typeof body?.name === "string" && body.name !== ""
      ? body.name
      : `${new Date().toISOString().slice(0, 10)}_${Math.round(Math.random() * 100)}`;
  const key = generateRandomString(32);
  const apikey = await createApikey(c.var.db, c.var.user!.id, name, key);
  return c.json({ apikey });
});

// 失効（要認証）。所有者一致のみ。non-uuid は pg エラーを避けて即 404
apikeyRoutes.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const ok = await deleteApikey(c.var.db, id, c.var.user!.id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
```

- [x] **Step 4: app.ts に mount**

import 追加:

```ts
import { apikeyRoutes } from "./routes/apikey";
```

`createApp` 内、`app.route("/api/settings", settingsRoutes);` の直後に:

```ts
  app.route("/api/apikey", apikeyRoutes);
```

- [x] **Step 5: テスト緑を確認 + typecheck**

Run: `pnpm --filter @picsur/api test routes/apikey && pnpm --filter @picsur/api typecheck`
Expected: PASS（7 test）、typecheck エラー無し。

- [x] **Step 6: Commit**

```bash
git add packages/api/src/routes/apikey.ts packages/api/src/routes/apikey.test.ts packages/api/src/app.ts
git commit -m "feat(api): add apikey issue/list/revoke routes"
```

---

## Task 7: `POST /api/auth/password` パスワード変更（TDD, testcontainers）

**Files:**
- Modify: `packages/api/src/routes/auth.ts`
- Modify: `packages/api/src/routes/auth.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/routes/auth.test.ts` 末尾に追加**

```ts
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
```

> 注: このファイルの既存テストは "hunter2" でログインする。rotation テストは最後に必ず元へ戻す（restore のアサートまで含めてある）。テストはファイル内で宣言順に直列実行されるため、末尾追加なら既存テストへの影響はない。

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test routes/auth`
Expected: FAIL（`/api/auth/password` が無く 404 等）

- [x] **Step 3: 実装 — `packages/api/src/routes/auth.ts`**

import を更新:

```ts
import { hashPassword, verifyPassword } from "../auth/password";
import { getUserByUsername, updatePassword } from "../db/queries";
```

ファイル末尾（`/me` ルートの後）に追加:

```ts
// パスワード変更（要認証）。現パスワード照合 → bcrypt 再ハッシュ
authRoutes.post("/password", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.new === "string" ? body.new : "";
  if (next === "") {
    return c.json({ error: "new password required" }, 400);
  }

  const me = c.var.user!;
  const row = await getUserByUsername(c.var.db, me.username);
  const ok = row ? await verifyPassword(current, row.password) : false;
  if (!ok) {
    return c.json({ error: "invalid credentials" }, 401);
  }

  await updatePassword(c.var.db, me.id, await hashPassword(next));
  return c.json({ ok: true });
});
```

- [x] **Step 4: テスト緑を確認 + typecheck**

Run: `pnpm --filter @picsur/api test routes/auth && pnpm --filter @picsur/api typecheck`
Expected: PASS（10 test）、typecheck エラー無し。

- [x] **Step 5: Commit**

```bash
git add packages/api/src/routes/auth.ts packages/api/src/routes/auth.test.ts
git commit -m "feat(api): add password change route"
```

---

## Task 8: 最終確認

- [x] **Step 1: 全テスト + ワークスペース全体の緑確認**

Run: `pnpm --filter @picsur/shared test && pnpm --filter @picsur/api test`
Expected: shared / api 全テスト PASS。

Run: `pnpm -r build && pnpm -r typecheck`
Expected: shared / api / web 全緑。

- [x] **Step 2: Commit（変更があれば）**

新規変更が無ければ commit 不要。

---

## 完了条件

- `GET /api/image/list` が自分の画像を created desc で返す（id / file_name / created / master_filetype / links）。
- `GET /api/settings` がデフォルト false、`PUT` で upsert（非 boolean は 400）。
- `POST /api/apikey` が 32 文字英数字 key（旧形式互換）を発行（name 省略時 `YYYY-MM-DD_<n>`）、`GET` で平文一覧、`DELETE /:id` で失効（non-uuid / 不在は 404）。**発行した key で authMiddleware を通過できる**（/api/auth/me が 200）。
- `POST /api/auth/password` が現パスワード照合（不一致 401、空 new 400）→ 更新。旧パスワード login 不可・新パスワード login 可。
- EXT マップが shared `constants.ts` に統合され、routes/image・routes/i の重複定義が消える。
- 全ルート未認証 401。全テスト + `pnpm -r build` + `pnpm -r typecheck` 緑。
- 後続: Phase 4（web SPA）。バックエンドはこれで完結。

## 実装完了メモ（2026-06-05、最終レビュー済み）

全 8 タスク完了（`d9ac5f2`〜`45a7999`）。shared 10 + api 100 テスト / `pnpm -r build` / `pnpm -r typecheck` 全緑。最終レビュー verdict: Ready to merge。**Phase 3（api バックエンド）はこれで完結。**

**途中で直した点:** updatePassword テストの後始末 / apikey レスポンスの snake_case 統一（`lastUsed` → `last_used`、最終レビュー指摘）。

**Phase 4（web SPA）への引き継ぎ:**
- API surface は 4 ページ分すべて揃っている（login / 一覧+upload / settings+apikey+password / 画像 view `/i`）。
- レスポンスは snake_case で統一（`file_name` / `master_filetype` / `keep_original` / `last_used`）。
- 認証は cookie（web）と `Api-Key` ヘッダ / `?key=`（ShareX・直リン）の両対応が全ルートで効いている。
- 既知の許容事項: パスワード変更後も既存 JWT は失効しない（stateless、単一 admin で許容）/ apikey デフォルト名の乱数は連番でなく衝突しうる（cosmetic）。

**Phase 5 への注意:** apikey は平文保存・無変換なので、migration で旧 `key` 値をそのまま運べば既存 ShareX 設定が生き続ける。
