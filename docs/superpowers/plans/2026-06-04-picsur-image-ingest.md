# Picsur Image Ingest + Delete Implementation Plan (Plan 3b-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/image`（アップロード: content-hash dedupe・filetype 検証・exif strip・master/original 保存）と `DELETE /api/image/:id`（所有者チェック付き削除）を実装する。両方とも要認証。

**Architecture:** 純粋処理（buffer → `{id, master, original?}`）を DB 非依存のサービス層（`services/`）に隔離し、DB I/O を `db/image-queries.ts` に、HTTP 配線を `routes/image.ts` に分ける。配信・変換（`GET /i`）は Plan 3b-2 へ。

**Tech Stack:** Hono / Drizzle / pg / sharp (native) / file-type / Vitest + testcontainers。設計の母体は `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「実装ノート: 画像パイプラインの分割」。

---

## File Structure

- Create: `packages/api/src/services/filetype.ts` — buffer → 実 mime 検出 + アニメ判定（file-type + sharp）
- Create: `packages/api/src/services/image-ingest.ts` — buffer → `{id, master, original?}` の DB 非依存処理 + `hashBuffer`
- Create: `packages/api/src/db/image-queries.ts` — image/image_file/settings の insert・dedupe lookup・delete
- Create: `packages/api/src/routes/image.ts` — `POST /api/image` / `DELETE /api/image/:id`
- Create: `packages/api/src/test/fixtures/` — テスト画像（PIL で生成しコミット）
- Create: `packages/api/src/test/fixtures.ts` — fixture を読み込むヘルパ
- Modify: `packages/api/package.json` — sharp / file-type 依存追加
- Modify: `packages/api/src/app.ts` — image ルートを mount
- Modify: ルート `package.json` — `onlyBuiltDependencies` に sharp 追加

---

## Task 1: 依存追加（sharp, file-type）

**Files:**
- Modify: `packages/api/package.json`
- Modify: `package.json`（ルート）

- [ ] **Step 1: api に依存追加**

Run:
```bash
cd packages/api
pnpm add sharp@^0.34 file-type@^19
```

> file-type は 19.x（pure ESM, Node18+）を使う。22.x は Node22+ 要件かつ sub-exports 廃止の breaking があるため、まず 19.x で進める。

- [ ] **Step 2: ルート `package.json` の `onlyBuiltDependencies` に sharp を追加**

`package.json`（ルート）の該当箇所を以下にする（bcrypt は既存）:

```json
  "pnpm": {
    "onlyBuiltDependencies": ["bcrypt", "sharp"]
  }
```

- [ ] **Step 3: 再インストールして native build を通す**

Run（リポジトリルートで）:
```bash
pnpm install
```
Expected: sharp の native binary が解決される（エラー無し）。

- [ ] **Step 4: sharp が import できるか smoke 確認**

Run:
```bash
cd packages/api
node --input-type=module -e "import sharp from 'sharp'; const b = await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer(); console.log('sharp ok', b.length > 0)"
```
Expected: `sharp ok true`

- [ ] **Step 5: Commit**

```bash
git add package.json packages/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add sharp and file-type deps for image pipeline"
```

---

## Task 2: テスト fixture の生成

**Files:**
- Create: `packages/api/src/test/fixtures/` 配下の画像
- Create: `packages/api/src/test/gen-fixtures.py`（生成スクリプト、再現用に残す）

sharp は raw バッファからのアニメ生成を公式サポートしないため、アニメ画像は PIL で生成してバイナリをコミットする。テスト実行時は外部ツール非依存。

- [ ] **Step 1: 生成スクリプトを作成 — `packages/api/src/test/gen-fixtures.py`**

```python
"""テスト用画像 fixture を生成する。再生成: python3 src/test/gen-fixtures.py"""
import os
from PIL import Image

d = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(d, exist_ok=True)

# 8x8 赤 PNG（静止・メタデータ無し）
Image.new("RGB", (8, 8), (255, 0, 0)).save(os.path.join(d, "red.png"))

# 8x8 JPG に EXIF を埋め込む（master で除去されることの検証用）
img = Image.new("RGB", (8, 8), (0, 128, 255))
exif = Image.Exif()
exif[0x0132] = "2020:01:01 00:00:00"  # DateTime tag
img.save(os.path.join(d, "exif.jpg"), exif=exif)

# 8x8 静止 WebP
Image.new("RGB", (8, 8), (0, 255, 0)).save(os.path.join(d, "still.webp"))

# 2 フレームのアニメ WebP / GIF
f1 = Image.new("RGB", (8, 8), (255, 0, 0))
f2 = Image.new("RGB", (8, 8), (0, 0, 255))
f1.save(os.path.join(d, "anim.webp"), save_all=True, append_images=[f2], duration=100, loop=0)
f1.save(os.path.join(d, "anim.gif"), save_all=True, append_images=[f2], duration=100, loop=0)

# 非対応形式（テキスト）: 415 検証用
with open(os.path.join(d, "notimage.txt"), "wb") as fp:
    fp.write(b"this is not an image")

print("fixtures written to", d)
```

- [ ] **Step 2: 生成して中身を確認**

Run:
```bash
cd packages/api
python3 src/test/gen-fixtures.py
ls -la src/test/fixtures/
```
Expected: `red.png` / `exif.jpg` / `still.webp` / `anim.webp` / `anim.gif` / `notimage.txt` が生成される。

- [ ] **Step 3: アニメ fixture が sharp で 2 ページと読めるか確認**

Run:
```bash
node --input-type=module -e "import sharp from 'sharp'; import {readFileSync} from 'node:fs'; for (const f of ['anim.webp','anim.gif']) { const m = await sharp(readFileSync('src/test/fixtures/'+f), {animated:true}).metadata(); console.log(f, 'pages=', m.pages); }"
```
Expected: `anim.webp pages= 2` と `anim.gif pages= 2`（sharp が PIL 生成のアニメを 2 フレームと認識する）。もし pages が 1 なら fixture 生成方法を見直して報告。

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/test/gen-fixtures.py packages/api/src/test/fixtures/
git commit -m "test(api): add image fixtures (still/animated png/jpg/webp/gif) for ingest"
```

---

## Task 3: filetype サービス（TDD）

buffer から実 mime を検出し、対応形式か検証し、アニメか判定する。

**Files:**
- Create: `packages/api/src/services/filetype.ts`
- Test: `packages/api/src/services/filetype.test.ts`

- [ ] **Step 1: 失敗するテストを書く — `packages/api/src/services/filetype.test.ts`**

```ts
import { expect, test } from "vitest";
import { fixture } from "../test/fixtures";
import { detectImageType } from "./filetype";

test("detects a still png as image/png, not animated", async () => {
  const r = await detectImageType(await fixture("red.png"));
  expect(r).toEqual({ mime: "image/png", animated: false });
});

test("detects a jpeg", async () => {
  const r = await detectImageType(await fixture("exif.jpg"));
  expect(r).toEqual({ mime: "image/jpeg", animated: false });
});

test("detects an animated webp", async () => {
  const r = await detectImageType(await fixture("anim.webp"));
  expect(r).toEqual({ mime: "image/webp", animated: true });
});

test("detects an animated gif", async () => {
  const r = await detectImageType(await fixture("anim.gif"));
  expect(r).toEqual({ mime: "image/gif", animated: true });
});

test("returns null for an unsupported (non-image) buffer", async () => {
  const r = await detectImageType(await fixture("notimage.txt"));
  expect(r).toBe(null);
});
```

- [ ] **Step 2: fixture ヘルパを作成 — `packages/api/src/test/fixtures.ts`**

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): Promise<Buffer> {
  return readFile(join(here, "fixtures", name));
}
```

- [ ] **Step 3: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test filetype`
Expected: FAIL（`./filetype` が無い）

- [ ] **Step 4: 実装 — `packages/api/src/services/filetype.ts`**

```ts
import { isSupportedMime, type SupportedMime } from "@picsur/shared";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export interface DetectedType {
  mime: SupportedMime;
  animated: boolean;
}

// buffer の実バイトから mime を判定し、対応形式なら DetectedType、それ以外は null。
export async function detectImageType(
  buf: Buffer,
): Promise<DetectedType | null> {
  const ft = await fileTypeFromBuffer(buf);
  if (!ft || !isSupportedMime(ft.mime)) return null;

  const meta = await sharp(buf, { animated: true }).metadata();
  const animated = (meta.pages ?? 1) > 1;
  return { mime: ft.mime, animated };
}
```

- [ ] **Step 5: テスト緑を確認**

Run: `pnpm --filter @picsur/api test filetype`
Expected: PASS（5 test）

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/filetype.ts packages/api/src/services/filetype.test.ts packages/api/src/test/fixtures.ts
git commit -m "feat(api): add filetype detection service (mime + animated)"
```

---

## Task 4: image-ingest サービス（TDD）

buffer を受け取り、content-hash id と exif-strip 済み master（+ keep_original 時の original）を返す。DB 非依存。

**Files:**
- Create: `packages/api/src/services/image-ingest.ts`
- Test: `packages/api/src/services/image-ingest.test.ts`

- [ ] **Step 1: 失敗するテストを書く — `packages/api/src/services/image-ingest.test.ts`**

```ts
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "vitest";
import { fixture } from "../test/fixtures";
import { hashBuffer, processImage } from "./image-ingest";

test("hashBuffer is the sha256 hex of the input", async () => {
  const buf = await fixture("red.png");
  const expected = createHash("sha256").update(buf).digest("hex");
  expect(hashBuffer(buf)).toBe(expected);
});

test("processImage returns id, master with same mime, no original by default", async () => {
  const buf = await fixture("red.png");
  const r = await processImage(buf, false);
  expect(r).not.toBe(null);
  expect(r!.id).toBe(hashBuffer(buf));
  expect(r!.master.filetype).toBe("image/png");
  expect(r!.original).toBeUndefined();
  // master は valid な png
  const meta = await sharp(r!.master.data).metadata();
  expect(meta.format).toBe("png");
});

test("processImage strips exif from the master", async () => {
  const buf = await fixture("exif.jpg");
  // 入力には exif がある
  const inMeta = await sharp(buf).metadata();
  expect(inMeta.exif).toBeDefined();
  // master には無い
  const r = await processImage(buf, false);
  const outMeta = await sharp(r!.master.data).metadata();
  expect(outMeta.exif).toBeUndefined();
});

test("processImage keeps animation frames in the master", async () => {
  const buf = await fixture("anim.webp");
  const r = await processImage(buf, false);
  const meta = await sharp(r!.master.data, { animated: true }).metadata();
  expect(meta.pages).toBe(2);
});

test("processImage keeps the original (verbatim) when keepOriginal is true", async () => {
  const buf = await fixture("red.png");
  const r = await processImage(buf, true);
  expect(r!.original).toBeDefined();
  expect(r!.original!.filetype).toBe("image/png");
  expect(Buffer.compare(r!.original!.data, buf)).toBe(0);
});

test("processImage returns null for an unsupported buffer", async () => {
  const r = await processImage(await fixture("notimage.txt"), false);
  expect(r).toBe(null);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test image-ingest`
Expected: FAIL（`./image-ingest` が無い）

- [ ] **Step 3: 実装 — `packages/api/src/services/image-ingest.ts`**

```ts
import { createHash } from "node:crypto";
import type { SupportedMime } from "@picsur/shared";
import sharp from "sharp";
import { detectImageType } from "./filetype";

export interface IngestFile {
  filetype: string;
  data: Buffer;
}

export interface IngestResult {
  id: string;
  master: IngestFile;
  original?: IngestFile;
}

// mime → sharp の出力フォーマット
const OUTPUT_FORMAT: Record<SupportedMime, "png" | "jpeg" | "webp" | "gif"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// 元形式を維持したまま再エンコードし exif/metadata を除去（アニメはフレーム保持）。
// 非対応形式なら null。
export async function processImage(
  buf: Buffer,
  keepOriginal: boolean,
): Promise<IngestResult | null> {
  const detected = await detectImageType(buf);
  if (!detected) return null;

  const fmt = OUTPUT_FORMAT[detected.mime];
  const masterData = await sharp(buf, { animated: true })
    .toFormat(fmt)
    .toBuffer();

  const result: IngestResult = {
    id: hashBuffer(buf),
    master: { filetype: detected.mime, data: masterData },
  };
  if (keepOriginal) {
    result.original = { filetype: detected.mime, data: buf };
  }
  return result;
}
```

- [ ] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test image-ingest`
Expected: PASS（6 test）

> もし exif strip テストが落ちる（master に exif が残る）場合、sharp は `withMetadata()` を呼ばない限り strip するはずなので fixture 側の exif が検出されていない可能性。`sharp(buf).metadata()` で入力 exif を確認して報告。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/image-ingest.ts packages/api/src/services/image-ingest.test.ts
git commit -m "feat(api): add image ingest service (hash, exif strip, master/original)"
```

---

## Task 5: image / settings DB クエリ（TDD, testcontainers）

dedupe lookup・保存（image + image_file をトランザクション）・削除・settings 取得。

**Files:**
- Create: `packages/api/src/db/image-queries.ts`
- Test: `packages/api/src/db/image-queries.test.ts`

- [ ] **Step 1: 失敗するテストを書く — `packages/api/src/db/image-queries.test.ts`**

```ts
import { settings } from "@picsur/shared";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import {
  deleteImage,
  findImageById,
  getSettings,
  insertImage,
} from "./image-queries";

let t: TestDb;
let adminId: string;

beforeAll(async () => {
  t = await startTestDb();
  adminId = await seedAdmin(t.db, "admin", "hash");
});

afterAll(async () => {
  await t.teardown();
});

const master = { filetype: "image/png", data: Buffer.from([1, 2, 3]) };

test("findImageById returns null when absent", async () => {
  expect(await findImageById(t.db, "missing")).toBe(null);
});

test("insertImage then findImageById round-trips metadata", async () => {
  await insertImage(
    t.db,
    { id: "img-a", userId: adminId, fileName: "a.png" },
    master,
  );
  const row = await findImageById(t.db, "img-a");
  expect(row).toEqual({ id: "img-a", userId: adminId, fileName: "a.png" });
});

test("insertImage with original stores both image_file rows", async () => {
  await insertImage(
    t.db,
    { id: "img-b", userId: adminId, fileName: "b.png" },
    master,
    { filetype: "image/png", data: Buffer.from([9]) },
  );
  const { rows } = await t.pool.query(
    "select variant from image_file where image_id = $1 order by variant",
    ["img-b"],
  );
  expect(rows.map((r) => r.variant)).toEqual(["master", "original"]);
});

test("getSettings defaults keepOriginal to false when no row", async () => {
  expect(await getSettings(t.db)).toEqual({ keepOriginal: false });
});

test("getSettings reads keep_original from the settings row", async () => {
  await t.db.insert(settings).values({ id: 1, keepOriginal: true });
  expect(await getSettings(t.db)).toEqual({ keepOriginal: true });
});

test("deleteImage removes only the owner's image and cascades files", async () => {
  await insertImage(
    t.db,
    { id: "img-c", userId: adminId, fileName: "c.png" },
    master,
  );
  // 別ユーザー id では消えない
  expect(await deleteImage(t.db, "img-c", "other-user")).toBe(false);
  // 所有者なら消える
  expect(await deleteImage(t.db, "img-c", adminId)).toBe(true);
  expect(await findImageById(t.db, "img-c")).toBe(null);
  const { rows } = await t.pool.query(
    "select count(*)::int as n from image_file where image_id = $1",
    ["img-c"],
  );
  expect(rows[0].n).toBe(0);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test image-queries`
Expected: FAIL（`./image-queries` が無い）

- [ ] **Step 3: 実装 — `packages/api/src/db/image-queries.ts`**

```ts
import { image, imageFile, settings } from "@picsur/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import type { IngestFile } from "../services/image-ingest";

export interface ImageMeta {
  id: string;
  userId: string;
  fileName: string;
}

export async function findImageById(
  db: Db,
  id: string,
): Promise<ImageMeta | null> {
  const [row] = await db
    .select({ id: image.id, userId: image.userId, fileName: image.fileName })
    .from(image)
    .where(eq(image.id, id))
    .limit(1);
  return row ?? null;
}

// image + image_file(master, +original) を1トランザクションで挿入。
export async function insertImage(
  db: Db,
  meta: ImageMeta,
  master: IngestFile,
  original?: IngestFile,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(image).values({
      id: meta.id,
      userId: meta.userId,
      fileName: meta.fileName,
    });
    await tx.insert(imageFile).values({
      imageId: meta.id,
      variant: "master",
      filetype: master.filetype,
      data: master.data,
    });
    if (original) {
      await tx.insert(imageFile).values({
        imageId: meta.id,
        variant: "original",
        filetype: original.filetype,
        data: original.data,
      });
    }
  });
}

// 所有者一致で削除。消えたら true（FK cascade で image_file/derivative も削除）。
export async function deleteImage(
  db: Db,
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(image)
    .where(and(eq(image.id, id), eq(image.userId, userId)))
    .returning({ id: image.id });
  return deleted.length > 0;
}

export interface Settings {
  keepOriginal: boolean;
}

// settings は単一行（id=1）。行が無ければ keepOriginal=false にフォールバック。
export async function getSettings(db: Db): Promise<Settings> {
  const [row] = await db
    .select({ keepOriginal: settings.keepOriginal })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return { keepOriginal: row?.keepOriginal ?? false };
}
```

- [ ] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test image-queries`
Expected: PASS（6 test）

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/image-queries.ts packages/api/src/db/image-queries.test.ts
git commit -m "feat(api): add image/settings db queries (insert, dedupe, delete)"
```

---

## Task 6: `POST /api/image` ルート + app mount（TDD, testcontainers）

**Files:**
- Create: `packages/api/src/routes/image.ts`
- Test: `packages/api/src/routes/image.test.ts`
- Modify: `packages/api/src/app.ts`

- [ ] **Step 1: ルートを実装 — `packages/api/src/routes/image.ts`**

```ts
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import {
  findImageById,
  getSettings,
  insertImage,
} from "../db/image-queries";
import { hashBuffer, processImage } from "../services/image-ingest";
import type { AppBindings } from "../types";

export const imageRoutes = new Hono<AppBindings>();

// mime → 配信用拡張子
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function links(id: string, mime: string) {
  const ext = EXT[mime] ?? "bin";
  return { view: `/i/${id}`, direct: `/i/${id}.${ext}` };
}

// アップロード（要認証）。multipart の "file" フィールドを受け取る。
imageRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "no file" }, 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const user = c.var.user!;

  // dedupe: 既存 id なら再処理せず既存を返す
  const id = hashBuffer(buf);
  const existing = await findImageById(c.var.db, id);
  if (existing) {
    // master の filetype を引いて links を返す
    return c.json({ id: existing.id, file_name: existing.fileName, links: links(id, "image/png") });
  }

  const settings = await getSettings(c.var.db);
  const result = await processImage(buf, settings.keepOriginal);
  if (!result) {
    return c.json({ error: "unsupported file type" }, 415);
  }

  const fileName = file.name || "image";
  await insertImage(
    c.var.db,
    { id: result.id, userId: user.id, fileName },
    result.master,
    result.original,
  );

  return c.json({
    id: result.id,
    file_name: fileName,
    links: links(result.id, result.master.filetype),
  });
});
```

> dedupe 時の `links` の mime は厳密には master の filetype を引くべきだが、`view` URL は拡張子なしで動くため、ここでは `view` を主に使う前提で簡略化している。Plan 3b-2 で配信時に master の filetype を解決するため、ここで mime を厳密に返す必要はない。

- [ ] **Step 2: app.ts に mount — `packages/api/src/app.ts`**

`createApp` 内、`app.route("/api/auth", authRoutes);` の直後に追加:

```ts
  app.route("/api/image", imageRoutes);
```

そしてファイル冒頭の import に追加:

```ts
import { imageRoutes } from "./routes/image";
```

- [ ] **Step 3: 統合テストを書く — `packages/api/src/routes/image.test.ts`**

```ts
import type { Hono } from "hono";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createApp } from "../app";
import { hashPassword } from "../auth/password";
import { fixture } from "../test/fixtures";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import type { AppBindings } from "../types";

let tdb: TestDb;
let app: Hono<AppBindings>;

beforeAll(async () => {
  process.env.PICSUR_JWT_SECRET = "test-secret";
  tdb = await startTestDb();
  await seedAdmin(tdb.db, "admin", await hashPassword("hunter2"));
  app = createApp(tdb.db);
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
  const cookie = await loginCookie();
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
});

test("uploading the same bytes twice dedupes to the same id", async () => {
  const cookie = await loginCookie();
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
  const cookie = await loginCookie();
  const res = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(await fixture("notimage.txt"), "x.txt", "text/plain"),
  });
  expect(res.status).toBe(415);
});
```

- [ ] **Step 4: テスト実行**

Run: `pnpm --filter @picsur/api test routes/image`
Expected: PASS（4 test）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/image.ts packages/api/src/routes/image.test.ts packages/api/src/app.ts
git commit -m "feat(api): add POST /api/image upload route (dedupe, ingest, 415)"
```

---

## Task 7: `DELETE /api/image/:id` ルート（TDD, testcontainers）

**Files:**
- Modify: `packages/api/src/routes/image.ts`
- Modify: `packages/api/src/routes/image.test.ts`

- [ ] **Step 1: 失敗するテストを追記 — `packages/api/src/routes/image.test.ts`**

ファイル末尾に追加:

```ts
test("delete without auth returns 401", async () => {
  const res = await app.request("/api/image/whatever", { method: "DELETE" });
  expect(res.status).toBe(401);
});

test("delete removes an uploaded image", async () => {
  const cookie = await loginCookie();
  const up = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(await fixture("red.png"), "red.png", "image/png"),
  });
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
  const cookie = await loginCookie();
  const res = await app.request("/api/image/does-not-exist", {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test routes/image`
Expected: FAIL（DELETE ルートが無く 404 でなく別の結果、または delete 成功テストが落ちる）

- [ ] **Step 3: DELETE ルートを実装 — `packages/api/src/routes/image.ts`**

`import` に `deleteImage` を追加:

```ts
import {
  deleteImage,
  findImageById,
  getSettings,
  insertImage,
} from "../db/image-queries";
```

POST ルートの後に追加:

```ts
// 削除（要認証）。所有者一致のみ。
imageRoutes.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ok = await deleteImage(c.var.db, id, c.var.user!.id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test routes/image`
Expected: PASS（7 test）

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/image.ts packages/api/src/routes/image.test.ts
git commit -m "feat(api): add DELETE /api/image/:id route (owner-scoped)"
```

---

## Task 8: 最終確認

- [ ] **Step 1: api 全テスト緑**

Run: `pnpm --filter @picsur/api test`
Expected: password / jwt / app(health) / auth(統合) / queries / filetype / image-ingest / image-queries / routes/image 全て PASS。

- [ ] **Step 2: ワークスペース全体の build + typecheck**

Run: `pnpm -r build && pnpm -r typecheck`
Expected: shared / api / web 全緑。

> sharp は native 依存のため tsup では externalize される（bcrypt/pg と同様）。`pnpm -r build`（バンドル生成）が通ることだけ確認する。Docker runtime の node_modules 対応は Plan 5（deploy）。

- [ ] **Step 3: Commit（変更があれば）**

このタスクで新規変更が無ければ commit 不要。

---

## 完了条件

- `POST /api/image`（要認証）が multipart アップロードを受け、file-type で対応形式を検証（非対応は 415）、sha256 で dedupe、sharp で元形式維持の exif strip 済み master を保存、`keep_original` 設定時は original も保存し、`{id, file_name, links}` を返す。
- `DELETE /api/image/:id`（要認証）が所有者一致のときのみ削除し、cascade で image_file も消える。不在/不一致は 404。
- 未認証は両ルートとも 401。
- characterization テスト（still/animated の png/jpg/webp/gif fixture）+ 統合テストが testcontainers 上で全緑。
- 後続: Plan 3b-2（配信 `GET /i` + オンデマンド変換 + derivative + MutexFallBack）。dedupe 時の links の mime 厳密化もそこで配信ロジックと合わせて対応。
