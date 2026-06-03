# Picsur Shared Schema Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@picsur/shared` に Drizzle スキーマ（user / apikey / settings / image / image_file / image_derivative）、drizzle-zod 由来の DTO、共有定数、そして fresh DB 用の初期 migration を実装する。

**Architecture:** スキーマと型・DTO・定数は `@picsur/shared` に集約し、api（クエリ）と web（フォーム検証・レスポンス型）の両方が import する。DB 接続クライアントは Plan 3 で api 側が `drizzle(postgres(url), { schema })` として生成する（このフェーズでは作らない）。migration は drizzle-kit で生成し `packages/shared/drizzle/` に置く。

**Tech Stack:** Drizzle ORM (`drizzle-orm`), `drizzle-zod`, `drizzle-kit`, postgres.js (`postgres`), Zod, Vitest。

このプランは spec `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「実装フェーズ 2（shared）」に対応する。

---

## このプランで確定させる設計判断（レビュー対象）

1. **DB ドライバ = postgres.js (`postgres`)**。軽量・pure JS で tsup バンドルと相性が良い。bytea は `Uint8Array`/`Buffer` で扱う（Drizzle の `customType<{ data: Buffer }>` で `bytea` を定義）。
2. **`settings` は単一行テーブル**（`id smallint PK default 1`, `keep_original boolean not null default false`）。単一ユーザーなので key-value をやめて1行に集約。アプリは常に id=1 を読み書きする。
3. **カラムは clean な命名で新規定義**（旧 `hashed_password`→`password`、`roles` は撤去）。**既存 prod DB のデータ引き継ぎ migration（旧 `e_*_backend_v2` テーブルの RENAME / `hashed_password`→`password` / roles 列 drop / preferences→settings 変換）は本プランの対象外で、Plan 5（deploy）で実 DB に対して別途行う**。本プランの migration は「空の DB に clean なスキーマを作る」CREATE migration。
4. **migration 保存先 = `packages/shared/drizzle/`**、設定は `packages/shared/drizzle.config.ts`（`pnpm --filter @picsur/shared db:generate` が shared を cwd にして config を見つけられるよう shared 配下に置く）。
5. **variant は `'master' | 'original'`**（旧 enum の `ingest` は未使用なので採用しない）。

> **バージョン注記**: 記載の Drizzle 系バージョン（drizzle-orm ^0.38 / drizzle-zod ^0.6 / drizzle-kit ^0.30 / postgres ^3.4）は目安。インストール時に解決できない・API が異なる場合は、実際にインストールされた最新安定版の正しい流儀に合わせてよい（特に drizzle-zod の `createInsertSchema`/`createSelectSchema` シグネチャ、`pgTable` 第2引数の制約定義の書き方=オブジェクト返し vs 配列返し、が版で変わりうる）。**変更したら何をどう変えたか報告すること**。ゴールは「スキーマ・DTO・定数・初期 migration が揃い、テストと typecheck が緑」。

---

## File Structure

- `packages/shared/package.json` — Drizzle 系依存を追加（modify）
- `packages/shared/drizzle.config.ts` — drizzle-kit 設定（create）
- `packages/shared/src/constants.ts` — variant・対応 mime 等の定数（create）
- `packages/shared/src/constants.test.ts` — 定数のテスト（create）
- `packages/shared/src/schema/bytea.ts` — bytea customType（create）
- `packages/shared/src/schema/auth.ts` — `user` / `apikey` / `settings` テーブル（create）
- `packages/shared/src/schema/image.ts` — `image` / `image_file` / `image_derivative` テーブル（create）
- `packages/shared/src/schema/index.ts` — schema 再エクスポート（create）
- `packages/shared/src/dto.ts` — drizzle-zod DTO（create）
- `packages/shared/src/dto.test.ts` — DTO のテスト（create）
- `packages/shared/src/index.ts` — schema/dto/constants を再エクスポート（modify）
- `packages/shared/drizzle/*.sql` — 生成された初期 migration（generate）

---

## Task 1: Drizzle 依存と drizzle-kit 設定、共有定数

**Files:**
- Modify: `packages/shared/package.json`
- Create: `drizzle.config.ts`
- Create: `packages/shared/src/constants.ts`
- Test: `packages/shared/src/constants.test.ts`

- [ ] **Step 1: shared に Drizzle 系依存を追加**

`packages/shared/package.json` の `dependencies` / `devDependencies` を以下に置き換える（既存 scripts は維持、`db:generate` を追加）:

```json
{
  "name": "@picsur/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "drizzle-orm": "^0.38.0",
    "drizzle-zod": "^0.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "postgres": "^3.4.5",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: `packages/shared/drizzle.config.ts` を作成**

（shared を cwd にして実行するため schema/out は shared からの相対パス）

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    host: process.env.PICSUR_DB_HOST ?? "localhost",
    port: Number(process.env.PICSUR_DB_PORT ?? 5432),
    user: process.env.PICSUR_DB_USER ?? "picsur",
    password: process.env.PICSUR_DB_PASSWORD ?? "picsur",
    database: process.env.PICSUR_DB_DATABASE ?? "picsur",
    ssl: false,
  },
});
```

- [ ] **Step 3: 失敗するテストを書く — `packages/shared/src/constants.test.ts`**

```ts
import { expect, test } from "vitest";
import { IMAGE_VARIANTS, SUPPORTED_MIMES, isSupportedMime } from "./constants";

test("IMAGE_VARIANTS lists master and original", () => {
  expect(IMAGE_VARIANTS).toEqual(["master", "original"]);
});

test("SUPPORTED_MIMES covers png/jpeg/webp/gif", () => {
  expect(SUPPORTED_MIMES).toEqual([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);
});

test("isSupportedMime accepts supported and rejects others", () => {
  expect(isSupportedMime("image/png")).toBe(true);
  expect(isSupportedMime("image/tiff")).toBe(false);
  expect(isSupportedMime("application/json")).toBe(false);
});
```

- [ ] **Step 4: 依存を入れてテスト失敗を確認**

Run: `pnpm install && pnpm --filter @picsur/shared test`
Expected: FAIL（`./constants` が無い）

- [ ] **Step 5: 定数を実装 — `packages/shared/src/constants.ts`**

```ts
export const IMAGE_VARIANTS = ["master", "original"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

export const SUPPORTED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type SupportedMime = (typeof SUPPORTED_MIMES)[number];

export function isSupportedMime(mime: string): mime is SupportedMime {
  return (SUPPORTED_MIMES as readonly string[]).includes(mime);
}
```

- [ ] **Step 6: テスト緑を確認**

Run: `pnpm --filter @picsur/shared test`
Expected: PASS（constants の3 test + 既存 index の1 test）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shared): add drizzle deps, drizzle-kit config, and image constants"
```

---

## Task 2: bytea カスタム型と auth スキーマ（user / apikey / settings）

**Files:**
- Create: `packages/shared/src/schema/bytea.ts`
- Create: `packages/shared/src/schema/auth.ts`

- [ ] **Step 1: bytea customType を作成 — `packages/shared/src/schema/bytea.ts`**

```ts
import { customType } from "drizzle-orm/pg-core";

// Postgres bytea を Node の Buffer として扱うカスタム型
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
```

- [ ] **Step 2: auth スキーマを作成 — `packages/shared/src/schema/auth.ts`**

```ts
import {
  boolean,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// 管理者ユーザー（単一ユーザー運用だがテーブルで保持）
export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash
});

// ShareX 等で使う API キー
export const apikey = pgTable("apikey", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
  lastUsed: timestamp("last_used", { withTimezone: true }),
});

// アプリ設定（単一行: id=1 を読み書きする）
export const settings = pgTable("settings", {
  id: smallint("id").primaryKey().default(1),
  keepOriginal: boolean("keep_original").notNull().default(false),
});
```

- [ ] **Step 3: 型が通るか確認（typecheck）**

Run: `pnpm --filter @picsur/shared typecheck`
Expected: エラー無し（schema ファイルは index から未参照でも include 対象なので型チェックされる。参照されず unused でも型エラーにはならない）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shared): add bytea type and auth schema (user, apikey, settings)"
```

---

## Task 3: image スキーマ（image / image_file / image_derivative）

**Files:**
- Create: `packages/shared/src/schema/image.ts`
- Create: `packages/shared/src/schema/index.ts`

- [ ] **Step 1: image スキーマを作成 — `packages/shared/src/schema/image.ts`**

```ts
import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { user } from "./auth";

// 画像メタデータ。id は アップロード内容の SHA-256 hex（content-addressed, dedupe）
export const image = pgTable("image", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
  fileName: text("file_name").notNull().default("image"),
});

// variant ごとの実バイト（master 必須 / original は keep_original 時のみ）
export const imageFile = pgTable(
  "image_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: text("image_id")
      .notNull()
      .references(() => image.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(), // 'master' | 'original'
    filetype: text("filetype").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [unique().on(t.imageId, t.variant)],
);

// オンデマンド形式変換のキャッシュ。key = sha256(対象形式)
export const imageDerivative = pgTable(
  "image_derivative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: text("image_id")
      .notNull()
      .references(() => image.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    filetype: text("filetype").notNull(),
    lastRead: timestamp("last_read", { withTimezone: true })
      .notNull()
      .defaultNow(),
    data: bytea("data").notNull(),
  },
  (t) => [unique().on(t.imageId, t.key)],
);
```

- [ ] **Step 2: schema バレルを作成 — `packages/shared/src/schema/index.ts`**

```ts
export { user, apikey, settings } from "./auth";
export { image, imageFile, imageDerivative } from "./image";
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @picsur/shared typecheck`
Expected: エラー無し

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shared): add image schema (image, image_file, image_derivative)"
```

---

## Task 4: drizzle-zod DTO とテスト

**Files:**
- Create: `packages/shared/src/dto.ts`
- Test: `packages/shared/src/dto.test.ts`

- [ ] **Step 1: 失敗するテストを書く — `packages/shared/src/dto.test.ts`**

```ts
import { expect, test } from "vitest";
import { insertUserSchema, insertApikeySchema } from "./dto";

test("insertUserSchema accepts a valid user payload", () => {
  const parsed = insertUserSchema.safeParse({
    username: "admin",
    password: "hashed",
  });
  expect(parsed.success).toBe(true);
});

test("insertUserSchema rejects a missing username", () => {
  const parsed = insertUserSchema.safeParse({ password: "hashed" });
  expect(parsed.success).toBe(false);
});

test("insertApikeySchema requires userId, key, name", () => {
  const ok = insertApikeySchema.safeParse({
    key: "k",
    userId: "00000000-0000-0000-0000-000000000000",
    name: "sharex",
  });
  expect(ok.success).toBe(true);

  const bad = insertApikeySchema.safeParse({ name: "sharex" });
  expect(bad.success).toBe(false);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/shared test`
Expected: FAIL（`./dto` が無い）

- [ ] **Step 3: DTO を実装 — `packages/shared/src/dto.ts`**

```ts
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  apikey,
  image,
  imageDerivative,
  imageFile,
  settings,
  user,
} from "./schema";

export const insertUserSchema = createInsertSchema(user);
export const selectUserSchema = createSelectSchema(user);

export const insertApikeySchema = createInsertSchema(apikey);
export const selectApikeySchema = createSelectSchema(apikey);

export const insertImageSchema = createInsertSchema(image);
export const selectImageSchema = createSelectSchema(image);

export const insertImageFileSchema = createInsertSchema(imageFile);
export const selectImageFileSchema = createSelectSchema(imageFile);

export const insertImageDerivativeSchema = createInsertSchema(imageDerivative);
export const selectImageDerivativeSchema = createSelectSchema(imageDerivative);

export const selectSettingsSchema = createSelectSchema(settings);
```

- [ ] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/shared test`
Expected: PASS（dto の3 test を含む全テスト）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @picsur/shared typecheck`
Expected: エラー無し

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): add drizzle-zod DTOs for all tables"
```

---

## Task 5: 初期 migration 生成と dev DB への適用検証

**Files:**
- Generate: `packages/shared/drizzle/*.sql` + `packages/shared/drizzle/meta/*`

- [ ] **Step 1: 初期 migration を生成**

Run: `pnpm --filter @picsur/shared db:generate`
Expected: `packages/shared/drizzle/0000_*.sql`（CREATE TABLE 群）と `packages/shared/drizzle/meta/` が生成される。

- [ ] **Step 2: 生成 SQL を目視確認**

Run: `cat packages/shared/drizzle/0000_*.sql`
Expected: `user` / `apikey` / `settings` / `image` / `image_file` / `image_derivative` の CREATE TABLE が含まれ、`image_file`・`image_derivative` の `data` カラムが `bytea`、FK が `image_id`→`image`・`user_id`→`user`、unique 制約（image_id+variant, image_id+key）がある。

- [ ] **Step 3: dev postgres を起動して migration を適用（best-effort）**

Run: `docker compose up -d postgres`
Run（postgres が healthy になるまで待ってから）:
`docker compose exec -T postgres psql -U picsur -d picsur -f - < packages/shared/drizzle/0000_*.sql`
（または drizzle-kit migrate を使う: `PICSUR_DB_HOST=localhost pnpm --filter @picsur/shared exec drizzle-kit migrate` — config の dbCredentials を使い localhost:5432 へ適用）

Expected: エラー無く適用される。

- [ ] **Step 4: テーブルが出来たか確認**

Run: `docker compose exec -T postgres psql -U picsur -d picsur -c "\dt"`
Expected: `user` `apikey` `settings` `image` `image_file` `image_derivative` の6テーブルが存在。

Run: `docker compose down`

> **docker daemon が無い場合**: Step 1-2（生成と目視）まで実施し、Step 3-4（実適用）は実行できない旨を報告して DONE_WITH_CONCERNS とする。生成 SQL の内容が Step 2 の期待を満たしていれば良しとする。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): generate initial drizzle migration for clean schema"
```

---

## Task 6: index 再エクスポートと最終確認

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: index から schema/dto/constants を再エクスポート**

`packages/shared/src/index.ts` を以下に置き換える:

```ts
export const PICSUR_VERSION = "0.6.0";

export * from "./constants";
export * from "./schema";
export * from "./dto";
```

- [ ] **Step 2: 既存の index テスト（PICSUR_VERSION）が緑のままか + 全テスト確認**

Run: `pnpm --filter @picsur/shared test`
Expected: PASS（index / constants / dto の全テスト）

- [ ] **Step 3: shared 全体の typecheck と、ワークスペース全体への影響確認**

Run: `pnpm --filter @picsur/shared typecheck`
Expected: エラー無し

Run: `pnpm -r build && pnpm -r typecheck`
Expected: shared / api / web 全て緑。

> **注意**: shared が `export * from "./schema"` で drizzle-orm を再エクスポートするようになる。api は tsup の `noExternal: [/@picsur\/shared/]` で shared をバンドルするが、api は現状 `PICSUR_VERSION` しか使わないので esbuild のツリーシェイクで drizzle-orm のコードは落ちるはず（drizzle-orm は副作用 import が無い）。もし api の build が「drizzle-orm を解決できない」等で**失敗する**場合は、ツリーシェイクが効いていない兆候。その場合は推測で握りつぶさず報告すること（api が実際に DB を使う Plan 3 で tsup の externalize 方針 + Plan 5 の pnpm-deploy 化を見直す前提なので、ここで無理に api 側をいじらない）。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shared): re-export schema, dto, and constants from index"
```

---

## 完了条件

- `@picsur/shared` が user/apikey/settings/image/image_file/image_derivative の Drizzle スキーマ、drizzle-zod DTO、定数を export
- 初期 migration SQL が `packages/shared/drizzle/` に生成され、（docker があれば）dev DB に適用して6テーブルが作られることを確認
- `pnpm -r test/build/typecheck` 全緑
- 後続: Plan 3（api: DB 接続 + 認証 + 画像パイプライン）へ。prod データ引き継ぎ migration は Plan 5（deploy）で実施。
