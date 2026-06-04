# Picsur Image Serve + Convert Implementation Plan (Plan 3b-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /i/:id(.:ext)`（要認証の画像配信 + オンデマンド形式変換 + derivative キャッシュ + MutexFallBack）を実装し、3b-1 の引き継ぎ 3 点（dedupe links の mime 厳密化 / owner コメント / keep_original 統合テスト）を解消する。

**Architecture:** 排他制御（`util/mutex-fallback.ts`）と形式変換（`services/image-convert.ts`）を独立ユニットにし、derivative の DB I/O を `db/image-queries.ts` に追加、配信の HTTP 配線を `routes/i.ts` に置く。`findImageById` は master filetype 付きに拡張して dedupe links 修正と共用する。

**Tech Stack:** Hono / Drizzle / pg / sharp / Vitest + testcontainers。設計は `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「Plan 3b-2 の決定事項」節。

---

## File Structure

- Create: `packages/api/src/util/mutex-fallback.ts` — key 排他の cache-or-generate（旧 `archive/backend/src/util/mutex-fallback.ts` を移植）
- Create: `packages/api/src/services/image-convert.ts` — `convertImage(buf, targetMime)` + `derivativeKey(targetMime)`（DB 非依存）
- Create: `packages/api/src/routes/i.ts` — `GET /i/:idWithExt` 配信ルート
- Modify: `packages/api/src/services/image-ingest.ts` — `OUTPUT_FORMAT` を export（convert と共用、DRY）
- Modify: `packages/api/src/db/image-queries.ts` — `findImageById` に masterFiletype、`getImageFile` / `getDerivative` / `insertDerivative` 追加
- Modify: `packages/api/src/routes/image.ts` — dedupe 分岐の links 厳密化 + owner コメント
- Modify: `packages/api/src/app.ts` — `/i` を mount

---

## Task 1: MutexFallBack の移植（TDD）

並行する同一 key の生成処理を 1 回に抑える排他ユーティリティ。`mainFunc`（cache lookup）が値を返せばそれを返し、null/undefined なら `fallBackFunc`（生成）を key 排他で実行する。別の呼び出しが同 key の fallback 実行中なら、その完了を待って mainFunc を再試行する。

**Files:**
- Create: `packages/api/src/util/mutex-fallback.ts`
- Test: `packages/api/src/util/mutex-fallback.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/util/mutex-fallback.test.ts`**

```ts
import { expect, test } from "vitest";
import { mutexFallBack } from "./mutex-fallback";

test("returns the main value without calling fallback when main hits", async () => {
  let fallbackCalls = 0;
  const r = await mutexFallBack(
    "k1",
    async () => "cached",
    async () => {
      fallbackCalls++;
      return "generated";
    },
  );
  expect(r).toBe("cached");
  expect(fallbackCalls).toBe(0);
});

test("runs fallback when main misses and returns its value", async () => {
  let fallbackCalls = 0;
  const r = await mutexFallBack(
    "k2",
    async () => null,
    async () => {
      fallbackCalls++;
      return "generated";
    },
  );
  expect(r).toBe("generated");
  expect(fallbackCalls).toBe(1);
});

test("concurrent calls with the same key run fallback only once", async () => {
  let fallbackCalls = 0;
  const store = new Map<string, string>();

  const job = () =>
    mutexFallBack(
      "k3",
      async () => store.get("v") ?? null,
      async () => {
        fallbackCalls++;
        // 生成に時間がかかる想定
        await new Promise((r) => setTimeout(r, 50));
        store.set("v", "generated");
        return "generated";
      },
    );

  const results = await Promise.all([job(), job(), job(), job()]);
  expect(results).toEqual(["generated", "generated", "generated", "generated"]);
  expect(fallbackCalls).toBe(1);
});

test("different keys do not block each other", async () => {
  let calls = 0;
  const job = (key: string) =>
    mutexFallBack(
      key,
      async () => null,
      async () => {
        calls++;
        return key;
      },
    );
  const [a, b] = await Promise.all([job("ka"), job("kb")]);
  expect(a).toBe("ka");
  expect(b).toBe("kb");
  expect(calls).toBe(2);
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test mutex`
Expected: FAIL（`./mutex-fallback` が無い）

- [x] **Step 3: 実装 — `packages/api/src/util/mutex-fallback.ts`**

旧実装（`archive/backend/src/util/mutex-fallback.ts`）の忠実移植。fallback の rejection は呼び出し元へそのまま伝播させる（握りつぶして再試行ループに入らない）。

```ts
// 同一 key の生成処理（fallBackFunc）を 1 回に抑える排他ユーティリティ。
// mainFunc（cache lookup）が値を返せばそれを返す。null/undefined なら fallBackFunc を実行。
// 別呼び出しが同 key の fallback を実行中なら、その完了を待って mainFunc を再試行する。
// 旧 archive/backend/src/util/mutex-fallback.ts の移植（in-process 排他。マルチプロセスでは効かない）。
const fallBackMap: Record<string, Promise<unknown>> = {};

export async function mutexFallBack<O>(
  key: string,
  mainFunc: () => Promise<O | null | undefined>,
  fallBackFunc: () => Promise<O>,
): Promise<O> {
  const tried = await mainFunc();
  if (tried !== undefined && tried !== null) return tried;

  // 同 key の fallback が走っていれば待って再試行
  if (fallBackMap[key] !== undefined) {
    await fallBackMap[key];
    return mutexFallBack(key, mainFunc, fallBackFunc);
  }

  // 自分が fallback を開始する
  const fallBackPromise = fallBackFunc();
  fallBackMap[key] = fallBackPromise;
  fallBackPromise.finally(() => {
    delete fallBackMap[key];
  });

  return fallBackPromise;
}
```

- [x] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test mutex`
Expected: PASS（4 test）

- [x] **Step 5: typecheck**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

- [x] **Step 6: Commit**

```bash
git add packages/api/src/util/mutex-fallback.ts packages/api/src/util/mutex-fallback.test.ts
git commit -m "feat(api): port MutexFallBack for single-flight derivative generation"
```

---

## Task 2: image-convert サービス（TDD）

master buffer を対象形式に変換する（形式変換のみ、編集無し）。derivative の cache key 計算もここに置く。

**Files:**
- Create: `packages/api/src/services/image-convert.ts`
- Test: `packages/api/src/services/image-convert.test.ts`
- Modify: `packages/api/src/services/image-ingest.ts`（`OUTPUT_FORMAT` を export）

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/services/image-convert.test.ts`**

```ts
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "vitest";
import { fixture } from "../test/fixtures";
import { convertImage, derivativeKey } from "./image-convert";

test("derivativeKey is the sha256 hex of the target mime", () => {
  const expected = createHash("sha256").update("image/webp").digest("hex");
  expect(derivativeKey("image/webp")).toBe(expected);
});

test("converts a png to a valid webp", async () => {
  const buf = await fixture("red.png");
  const out = await convertImage(buf, "image/webp");
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("webp");
});

test("keeps animation frames when converting animated webp to gif", async () => {
  const buf = await fixture("anim.webp");
  const out = await convertImage(buf, "image/gif");
  const meta = await sharp(out, { animated: true }).metadata();
  expect(meta.format).toBe("gif");
  expect(meta.pages).toBe(2);
});

test("flattens an animated gif to a still png (first frame)", async () => {
  const buf = await fixture("anim.gif");
  const out = await convertImage(buf, "image/png");
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("png");
  // 静止画になっている（pages 無し or 1）
  expect(meta.pages ?? 1).toBe(1);
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test image-convert`
Expected: FAIL（`./image-convert` が無い）

- [x] **Step 3: `OUTPUT_FORMAT` を export — `packages/api/src/services/image-ingest.ts`**

既存の宣言に `export` を付けるだけ:

```ts
// mime → sharp の出力フォーマット
export const OUTPUT_FORMAT: Record<SupportedMime, "png" | "jpeg" | "webp" | "gif"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
};
```

- [x] **Step 4: 実装 — `packages/api/src/services/image-convert.ts`**

```ts
import { createHash } from "node:crypto";
import type { SupportedMime } from "@picsur/shared";
import sharp from "sharp";
import { OUTPUT_FORMAT } from "./image-ingest";

// derivative の cache key（設計: key = sha256(対象mime)）
export function derivativeKey(targetMime: SupportedMime): string {
  return createHash("sha256").update(targetMime).digest("hex");
}

// master buffer を対象形式に変換する（形式変換のみ、編集無し）。
// アニメ対応形式（webp/gif）へは {animated:true} でフレーム保持、png/jpeg へは 1 フレーム目に潰れる。
export async function convertImage(
  buf: Buffer,
  targetMime: SupportedMime,
): Promise<Buffer> {
  const animatedOut =
    targetMime === "image/webp" || targetMime === "image/gif";
  return sharp(buf, { animated: animatedOut })
    .toFormat(OUTPUT_FORMAT[targetMime])
    .toBuffer();
}
```

- [x] **Step 5: テスト緑を確認（image-ingest の回帰も）**

Run: `pnpm --filter @picsur/api test image-convert && pnpm --filter @picsur/api test image-ingest`
Expected: image-convert 4 test PASS、image-ingest 7 test PASS（export 化の回帰なし）。

- [x] **Step 6: typecheck**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

- [x] **Step 7: Commit**

```bash
git add packages/api/src/services/image-convert.ts packages/api/src/services/image-convert.test.ts packages/api/src/services/image-ingest.ts
git commit -m "feat(api): add image format conversion service with derivative key"
```

---

## Task 3: DB クエリ拡張（TDD, testcontainers）

`findImageById` を master filetype 付きに拡張し、配信用の `getImageFile` と derivative の `getDerivative` / `insertDerivative` を追加する。

**Files:**
- Modify: `packages/api/src/db/image-queries.ts`
- Modify: `packages/api/src/db/image-queries.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/db/image-queries.test.ts`**

既存テストの修正 + 新テスト追加。

(a) 既存の round-trip テストを `masterFiletype` 込みに更新:

```ts
test("insertImage then findImageById round-trips metadata", async () => {
  await insertImage(
    t.db,
    { id: "img-a", userId: adminId, fileName: "a.png" },
    master,
  );
  const row = await findImageById(t.db, "img-a");
  expect(row).toEqual({
    id: "img-a",
    userId: adminId,
    fileName: "a.png",
    masterFiletype: "image/png",
  });
});
```

(b) import に新関数を追加:

```ts
import {
  deleteImage,
  findImageById,
  getDerivative,
  getImageFile,
  getSettings,
  insertDerivative,
  insertImage,
} from "./image-queries";
```

(c) ファイル末尾に新テストを追加:

```ts
test("getImageFile returns the master bytes and filetype", async () => {
  await insertImage(
    t.db,
    { id: "img-f", userId: adminId, fileName: "f.png" },
    { filetype: "image/png", data: Buffer.from([7, 8, 9]) },
  );
  const f = await getImageFile(t.db, "img-f", "master");
  expect(f).not.toBe(null);
  expect(f!.filetype).toBe("image/png");
  expect(Buffer.compare(Buffer.from(f!.data), Buffer.from([7, 8, 9]))).toBe(0);
});

test("getImageFile returns null for a missing variant", async () => {
  expect(await getImageFile(t.db, "img-f", "original")).toBe(null);
});

test("insertDerivative then getDerivative round-trips and bumps last_read", async () => {
  await insertDerivative(t.db, "img-f", "key-1", "image/webp", Buffer.from([1]));

  const before = await t.pool.query(
    "select last_read from image_derivative where image_id = $1 and key = $2",
    ["img-f", "key-1"],
  );

  // last_read の差が出るよう少し待つ
  await new Promise((r) => setTimeout(r, 20));

  const d = await getDerivative(t.db, "img-f", "key-1");
  expect(d).not.toBe(null);
  expect(d!.filetype).toBe("image/webp");
  expect(Buffer.compare(Buffer.from(d!.data), Buffer.from([1]))).toBe(0);

  const after = await t.pool.query(
    "select last_read from image_derivative where image_id = $1 and key = $2",
    ["img-f", "key-1"],
  );
  expect(new Date(after.rows[0].last_read).getTime()).toBeGreaterThan(
    new Date(before.rows[0].last_read).getTime(),
  );
});

test("getDerivative returns null on miss", async () => {
  expect(await getDerivative(t.db, "img-f", "no-such-key")).toBe(null);
});

test("insertDerivative ignores a duplicate (image_id, key)", async () => {
  await insertDerivative(t.db, "img-f", "key-1", "image/webp", Buffer.from([9, 9]));
  const { rows } = await t.pool.query(
    "select count(*)::int as n from image_derivative where image_id = $1 and key = $2",
    ["img-f", "key-1"],
  );
  expect(rows[0].n).toBe(1);
  // 先勝ち: data は最初の [1] のまま
  const d = await getDerivative(t.db, "img-f", "key-1");
  expect(Buffer.compare(Buffer.from(d!.data), Buffer.from([1]))).toBe(0);
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test image-queries`
Expected: FAIL（`getImageFile` 等が export されていない / round-trip の `masterFiletype` が無い）

- [x] **Step 3: 実装 — `packages/api/src/db/image-queries.ts`**

(a) import を更新:

```ts
import { image, imageDerivative, imageFile, settings } from "@picsur/shared";
import type { ImageVariant } from "@picsur/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import type { IngestFile } from "../services/image-ingest";
```

(b) `ImageMeta` と `findImageById` を master filetype 付きに変更（master は insertImage のトランザクションで常に存在するので innerJoin）:

```ts
export interface ImageMeta {
  id: string;
  userId: string;
  fileName: string;
  masterFiletype: string;
}

export async function findImageById(
  db: Db,
  id: string,
): Promise<ImageMeta | null> {
  const [row] = await db
    .select({
      id: image.id,
      userId: image.userId,
      fileName: image.fileName,
      masterFiletype: imageFile.filetype,
    })
    .from(image)
    .innerJoin(
      imageFile,
      and(eq(imageFile.imageId, image.id), eq(imageFile.variant, "master")),
    )
    .where(eq(image.id, id))
    .limit(1);
  return row ?? null;
}
```

(c) ファイル末尾に追加:

```ts
export interface StoredFile {
  filetype: string;
  data: Buffer;
}

// variant ('master' | 'original') の実バイトを取得。
export async function getImageFile(
  db: Db,
  imageId: string,
  variant: ImageVariant,
): Promise<StoredFile | null> {
  const [row] = await db
    .select({ filetype: imageFile.filetype, data: imageFile.data })
    .from(imageFile)
    .where(
      and(eq(imageFile.imageId, imageId), eq(imageFile.variant, variant)),
    )
    .limit(1);
  return row ?? null;
}

// derivative を取得。hit なら last_read を更新する。
export async function getDerivative(
  db: Db,
  imageId: string,
  key: string,
): Promise<StoredFile | null> {
  const [row] = await db
    .select({
      id: imageDerivative.id,
      filetype: imageDerivative.filetype,
      data: imageDerivative.data,
    })
    .from(imageDerivative)
    .where(
      and(eq(imageDerivative.imageId, imageId), eq(imageDerivative.key, key)),
    )
    .limit(1);
  if (!row) return null;

  await db
    .update(imageDerivative)
    .set({ lastRead: new Date() })
    .where(eq(imageDerivative.id, row.id));

  return { filetype: row.filetype, data: row.data };
}

// derivative を保存。並行生成で unique(image_id, key) に衝突したら先勝ちで無視。
export async function insertDerivative(
  db: Db,
  imageId: string,
  key: string,
  filetype: string,
  data: Buffer,
): Promise<void> {
  await db
    .insert(imageDerivative)
    .values({ imageId, key, filetype, data })
    .onConflictDoNothing();
}
```

- [x] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test image-queries`
Expected: PASS（11 test）

- [x] **Step 5: 他テストの回帰 + typecheck**

`findImageById` の戻り値が変わったので、利用箇所（`routes/image.ts` の dedupe 分岐）が typecheck で壊れていないか確認。dedupe 分岐は `existing.id` / `existing.fileName` しか使っていないので通るはず。

Run: `pnpm --filter @picsur/api typecheck && pnpm --filter @picsur/api test routes/image`
Expected: typecheck エラー無し、routes/image 7 test PASS。

- [x] **Step 6: Commit**

```bash
git add packages/api/src/db/image-queries.ts packages/api/src/db/image-queries.test.ts
git commit -m "feat(api): add file/derivative queries, master filetype on findImageById"
```

---

## Task 4: 3b-1 引き継ぎ解消 — dedupe links 厳密化 + keep_original 統合テスト（TDD）

**Files:**
- Modify: `packages/api/src/routes/image.ts`
- Modify: `packages/api/src/routes/image.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/routes/image.test.ts`**

(a) 既存の dedupe テストに direct リンクのアサートを追加（still.webp の再アップロードなので `.webp` が正しい。現実装は `"image/png"` 固定なので `.png` が返って落ちる = RED）:

```ts
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
```

(b) keep_original ON の統合テストをファイル末尾に追加（settings 行を立てて POST → image_file 2 行。終わったら settings を消して他テストに影響させない）:

```ts
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
```

import に `settings` を追加:

```ts
import { settings } from "@picsur/shared";
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test routes/image`
Expected: dedupe テストが `.png` ≠ `.webp` で FAIL（keep_original テストは現実装で通るはずの characterization — 通った場合はそのまま）。

- [x] **Step 3: dedupe 分岐を修正 — `packages/api/src/routes/image.ts`**

dedupe 分岐を以下に変更:

```ts
  // dedupe: 既存 id なら再処理せず既存を返す。
  // 注: owner は見ない（単一 admin 前提。マルチユーザー化するなら要 owner チェック）
  const id = hashBuffer(buf);
  const existing = await findImageById(c.var.db, id);
  if (existing) {
    return c.json({
      id: existing.id,
      file_name: existing.fileName,
      links: links(id, existing.masterFiletype),
    });
  }
```

- [x] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test routes/image`
Expected: PASS（8 test）

- [x] **Step 5: typecheck**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

- [x] **Step 6: Commit**

```bash
git add packages/api/src/routes/image.ts packages/api/src/routes/image.test.ts
git commit -m "fix(api): use master filetype in dedupe links, cover keep_original e2e"
```

---

## Task 5: `GET /i` 配信ルート（TDD, testcontainers）

**Files:**
- Create: `packages/api/src/routes/i.ts`
- Test: `packages/api/src/routes/i.test.ts`
- Modify: `packages/api/src/app.ts`

- [x] **Step 1: ルートを実装 — `packages/api/src/routes/i.ts`**

```ts
import type { SupportedMime } from "@picsur/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  getDerivative,
  getImageFile,
  insertDerivative,
} from "../db/image-queries";
import { convertImage, derivativeKey } from "../services/image-convert";
import { mutexFallBack } from "../util/mutex-fallback";
import { requireAuth } from "../middleware/auth";
import type { AppBindings } from "../types";

export const iRoutes = new Hono<AppBindings>();

// 配信用拡張子 → mime
const EXT_TO_MIME: Record<string, SupportedMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function serve(c: Context<AppBindings>, filetype: string, data: Buffer) {
  c.header("Content-Type", filetype);
  // id は content-hash なので内容は不変。認証必須なので private。
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  // 埋め込み用（設計どおり）
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  return c.body(new Uint8Array(data));
}

// GET /i/:id または /i/:id.:ext（要認証 — 画像も完全プライベート）
iRoutes.get("/:idWithExt", requireAuth, async (c) => {
  const idWithExt = c.req.param("idWithExt");
  const dot = idWithExt.indexOf(".");
  const id = dot === -1 ? idWithExt : idWithExt.slice(0, dot);
  const ext = dot === -1 ? null : idWithExt.slice(dot + 1).toLowerCase();

  const targetMime = ext === null ? null : EXT_TO_MIME[ext];
  if (ext !== null && targetMime === undefined) {
    return c.json({ error: "not found" }, 404);
  }

  const master = await getImageFile(c.var.db, id, "master");
  if (!master) return c.json({ error: "not found" }, 404);

  // ext 無し、または master と同形式 → master をそのまま返す
  if (!targetMime || targetMime === master.filetype) {
    return serve(c, master.filetype, master.data);
  }

  // 別形式 → derivative キャッシュ。miss は mutex 内で変換して保存
  const key = derivativeKey(targetMime);
  const derivative = await mutexFallBack(
    `${id}:${targetMime}`,
    () => getDerivative(c.var.db, id, key),
    async () => {
      const data = await convertImage(master.data, targetMime);
      await insertDerivative(c.var.db, id, key, targetMime, data);
      return { filetype: targetMime, data };
    },
  );
  return serve(c, derivative.filetype, Buffer.from(derivative.data));
});
```


- [x] **Step 2: app.ts に mount — `packages/api/src/app.ts`**

import 追加:

```ts
import { iRoutes } from "./routes/i";
```

`createApp` 内、`app.route("/api/image", imageRoutes);` の直後に:

```ts
  app.route("/i", iRoutes);
```

- [x] **Step 3: 統合テストを書く — `packages/api/src/routes/i.test.ts`**

```ts
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
```

- [x] **Step 4: テスト実行**

Run: `pnpm --filter @picsur/api test routes/i.test`
Expected: PASS（9 test）。**一度も RED を見ていないので、検証性確認をすること**: 例えば `cache-control` の期待値を一時的に変えて落ちることを確認 → 戻す。

- [x] **Step 5: 回帰 + typecheck**

Run: `pnpm --filter @picsur/api test && pnpm --filter @picsur/api typecheck`
Expected: 全テスト PASS（routes/image・既存含む）、typecheck エラー無し。

- [x] **Step 6: Commit**

```bash
git add packages/api/src/routes/i.ts packages/api/src/routes/i.test.ts packages/api/src/app.ts
git commit -m "feat(api): add GET /i image serving with on-demand conversion cache"
```

---

## Task 6: 最終確認

- [x] **Step 1: api 全テスト + ワークスペース全体の緑確認**

Run: `pnpm --filter @picsur/api test`
Expected: 全テストファイル PASS（mutex / image-convert / image-queries 11 / routes/image 8 / routes/i 9 / 既存 auth・password・jwt・queries・health）。

Run: `pnpm -r build && pnpm -r typecheck`
Expected: shared / api / web 全緑。

- [x] **Step 2: Commit（変更があれば）**

新規変更が無ければ commit 不要。

---

## 完了条件

- `GET /i/:id`（要認証）が master をそのまま返し、`GET /i/:id.:ext` が同形式なら master・別形式なら derivative（キャッシュ + `last_read` 更新 + MutexFallBack 排他生成）を返す。
- レスポンスに `Content-Type` / `Cache-Control: private, max-age=31536000, immutable` / `Cross-Origin-Resource-Policy: cross-origin`。
- 未認証は 401、不在 id・不明 ext は 404。
- アニメ → webp/gif 変換でフレーム保持、→ png/jpg は 1 フレーム目。
- 3b-1 引き継ぎ解消: dedupe links が master の実形式、owner 未チェックのコメント明記、keep_original ON の統合テスト。
- 全テスト + `pnpm -r build` + `pnpm -r typecheck` 緑。
- 後続: Plan 3c（settings / apikey / パスワード変更 / 画像一覧 API）。

## 実装完了メモ（2026-06-04、最終レビュー済み）

全 6 タスク完了（`73e0dea`〜`d65b111`）。73 テスト（12 ファイル）/ `pnpm -r build` / `pnpm -r typecheck` 全緑。最終レビュー verdict: Ready to merge。

**途中で直した点:** jpeg 変換の白背景 flatten（sharp デフォルトは黒合成）/ 空 id guard + エッジ 3 テスト / ゼロコピー view 化 / insertDerivative の reject 契約コメント（mutex 無限再帰の防波堤）。

**Plan 3c への引き継ぎ:**
- `EXT`（mime→ext, routes/image.ts）と `EXT_TO_MIME`（ext→mime, routes/i.ts）が別ファイルに重複定義。3c で画像一覧の links を組むなら shared の constants への統合を検討。
- 画像一覧 API は `findImageById` と同じ master 限定 innerJoin パターンを流用すると variant ごとの重複行を避けられる。
- apikey 認証は authMiddleware が解決済みなので、3c は apikey の発行・失効ルートを足すだけで `/i` も `/api/image` も apikey で通る。
