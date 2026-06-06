# kuv Phase 5: デプロイ成果物（web self-contained 化 + 移行 SQL + 手順書）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧 Picsur CT からの blue-green 移行に必要な 3 成果物 — web を焼いた caddy イメージ、in-place 移行 SQL、CT セットアップ手順書 — を作る。

**Architecture:** web は node ビルドステージ → caddy:2-alpine の 2-stage Dockerfile で self-contained 化し、compose の bind-mount を解消。移行 SQL は restore 済み `kuv` DB に対する in-place RENAME（1 トランザクション、冒頭ガード付き）で、constraint / index / 型 / default を drizzle ベースライン（`packages/shared/drizzle/0000_*.sql`）に完全一致させる。例外として apikey のみテーブル再作成（旧テーブルは `"userId"` が最後尾でカラム順がベースラインと一致しないため。行数は高々数件）。検証は committed テストではなく、ローカルの使い捨て postgres コンテナでのリハーサル + `pg_dump --schema-only` diff。

**Tech Stack:** Docker multi-stage build、caddy:2-alpine、PostgreSQL 17（psql / pg_dump / pg_restore）、pnpm workspace。

**設計の母体:** `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「Phase 5 の移行戦略」「Phase 5 の決定事項」節。

---

## 前提知識（実装者向け）

- **旧スキーマの DDL は repo に無い。** 旧実装は削除済みで、git 履歴 `779a7e2` の `archive/backend/src/database/migrations/` が一次資料。本 plan の DDL は全 migration（V_0_3_0_a〜V_0_6_0_a）を通読して再構成済みなので、plan のコードをそのまま使ってよい。
- **旧 DB の最終状態**（dump restore で入ってくるもの）:
  - `e_user_backend`: `id` uuid PK(`PK_0b9d256d52e55a48d32e8b64d96`) DEFAULT uuid_generate_v4() / `username` varchar UNIQUE(`UQ_ae538430fd08b28f4ab297eff09`) + INDEX `IDX_ae538430fd08b28f4ab297eff0` / `roles` text[] / `hashed_password` varchar
  - `e_api_key_backend`: `id` uuid PK(`PK_e31f7dfe2db917a6ed1024f4e8b`) / `key` varchar UNIQUE(`UQ_a244964afdff398bab8a45017c8`) + INDEX `IDX_a244964afdff398bab8a45017c` / `name` varchar / `created` timestamptz / `last_used` timestamptz NULL / `"userId"` uuid FK(`FK_3a32374df29b25152a84f0d1025`)→e_user_backend CASCADE。**FK カラムは camelCase の `"userId"`**
  - `e_image_backend_v2`: `id` varchar PK(`PK_c227ae010c616ba910e5737ac03`) / `user_id` uuid（**FK なし**）/ `created` timestamptz / `file_name` varchar DEFAULT 'image' / `expires_at` timestamptz NULL / `delete_key` varchar NULL
  - `e_image_file_backend_v2`: `_id` uuid PK(`PK_677b08227794a2363554eed7268`) / `image_id` varchar FK(`FK_9f7db4b32b0c34965ae32482faf`) CASCADE + INDEX `IDX_9f7db4b32b0c34965ae32482fa` / `variant` varchar + INDEX `IDX_624c858cefb5429083b5c910fd` / `filetype` varchar / `data` bytea / UNIQUE(`UQ_303a57185f10a62447ebbdc2b7f`) (image_id, variant)
  - `e_image_derivative_backend_v2`: `_id` uuid PK(`PK_f00074bb7a7268d3227cdfbf452`) / `image_id` varchar FK(`FK_f7d74de2723367bde5ef284db6e`) CASCADE + INDEX `IDX_f7d74de2723367bde5ef284db6` / `key` varchar + INDEX `IDX_c2daefe1e3cf2fdb84a6b1249b` / `filetype` varchar / `last_read` timestamptz / `data` bytea / UNIQUE(`UQ_d214dd07be2118996e900cff2d4`) (image_id, key)
  - DROP 対象: `e_role_backend` / `e_sys_preference_backend` / `e_usr_preference_backend`（`user_id` uuid FK→user CASCADE）/ `e_system_state_backend` / TypeORM の `migrations` / v1 残骸 `e_image_backend`・`e_image_file_backend`・`e_image_derivative_backend`（0.6 移行後も DROP されず残っている可能性あり）
- **usr preference の value は文字列** `'true'` / `'false'`（キーは `keep_original` のみ）。
- **pg_dump 17.x は出力に `\restrict <ランダムトークン>` 行を挟む**ので、schema diff の前に `grep -vE '^\\(un)?restrict'` で除去する。
- 新スタックの認証: `Authorization: Api-Key <key>` ヘッダ、アップロードは `POST /api/image` の multipart `file` フィールド。

## File Structure

| ファイル | 役割 |
|---|---|
| `packages/web/Dockerfile`（新規） | web ビルド → caddy:2-alpine に dist/client を焼く |
| `docker-compose.yml`（修正） | caddy を `image:` + bind-mount から `build:` に変更 |
| `deploy/migrate-from-picsur.sql`（新規） | in-place 移行 SQL（1 トランザクション） |
| `deploy/MIGRATION.md`（新規） | CT セットアップ + 移行手順書（機微情報なし） |

---

### Task 1: `packages/web/Dockerfile` — web を caddy イメージに焼く

**Files:**
- Create: `packages/web/Dockerfile`

- [ ] **Step 1: Dockerfile を書く**

`packages/api/Dockerfile` と同じ workspace パターン。`@kuv/shared` は TS ソース直 export（`"main": "./src/index.ts"`）なので事前ビルド不要。

```dockerfile
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
# pnpm の --frozen-lockfile は workspace 全体の manifest を要求するため api の package.json も必要
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile --filter @kuv/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/web packages/web
RUN pnpm --filter @kuv/web build

FROM caddy:2-alpine
# Caddyfile は compose で bind-mount する（設定変更でリビルドしないため）
COPY --from=build /app/packages/web/dist/client /srv/web
```

- [ ] **Step 2: ビルドが通ることを確認**

Run: `docker build -f packages/web/Dockerfile -t kuv-web-test .`
Expected: 成功（exit 0）

- [ ] **Step 3: イメージ単体スモーク**

```bash
docker run -d --name kuv-web-smoke -p 18080:80 kuv-web-test caddy file-server --root /srv/web --listen :80
curl -sf http://localhost:18080/index.html | head -3
docker rm -f kuv-web-smoke
```

Expected: `<!DOCTYPE html>` で始まる HTML が出る。

- [ ] **Step 4: Commit**

```bash
git add packages/web/Dockerfile
git commit -m "feat(web): caddy イメージに dist/client を焼く self-contained Dockerfile"
```

---

### Task 2: `docker-compose.yml` — caddy を build 化して bind-mount 解消

**Files:**
- Modify: `docker-compose.yml`（caddy サービス）

- [ ] **Step 1: caddy サービスを書き換える**

現在:

```yaml
  caddy:
    image: caddy:2-alpine
    ports:
      - "8080:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      # web は静的SPA。`pnpm --filter @kuv/web build` で生成した dist/client を bind-mount する。
      # `docker compose up` の前に web をビルドしておくこと。
      # （本番向けに web をイメージへ焼く self-contained 化は後続のデプロイ整備フェーズで対応）
      - ./packages/web/dist/client:/srv/web
    depends_on:
      - api
```

変更後:

```yaml
  caddy:
    build:
      context: .
      dockerfile: packages/web/Dockerfile
    ports:
      - "8080:80"
    volumes:
      # Caddyfile だけは bind-mount（設定変更でイメージ再ビルドしないため）
      - ./Caddyfile:/etc/caddy/Caddyfile
    depends_on:
      - api
```

- [ ] **Step 2: compose 設定の妥当性確認**

Run: `KUV_JWT_SECRET=smoke docker compose config -q`
Expected: 出力なし・exit 0

- [ ] **Step 3: フルスタックスモーク**

```bash
KUV_JWT_SECRET=smoke docker compose up -d --build
sleep 5
curl -sf http://localhost:8080/ | head -3          # SPA の index.html
curl -s http://localhost:8080/api/auth/me          # api への proxy
KUV_JWT_SECRET=smoke docker compose down
```

Expected: `/` は `<!DOCTYPE html>` で始まる HTML、`/api/auth/me` は 401 系 JSON（`{"error":...}`。DB が空でもルーティングが生きていることが確認できれば OK）。

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): caddy を web 焼き込みイメージの build に変更し bind-mount を解消"
```

---

### Task 3: `deploy/migrate-from-picsur.sql` — in-place 移行 SQL

**Files:**
- Create: `deploy/migrate-from-picsur.sql`

- [ ] **Step 1: 移行 SQL を書く**

全文。restore 済み `kuv` DB に `psql -v ON_ERROR_STOP=1 -f` で適用する前提。**BEGIN/COMMIT を SQL 側に持つ**ので psql の `-1` は不要。

```sql
-- 旧 Picsur DB（pg_dump を restore したコピー）を kuv スキーマへ in-place 移行する。
-- 適用先は新 CT 側のコピーのみ。旧 DB には絶対に適用しない。
-- 使い方: psql -v ON_ERROR_STOP=1 -d kuv -f migrate-from-picsur.sql
-- 全体が 1 トランザクション。途中で失敗したら全ロールバックされる。

BEGIN;

-- ============================================================
-- 0. ガード
-- ============================================================

-- admin 以外（または所有者不明）の画像が 1 件でもあれば中断。
-- 自家用インスタンスで匿名アップロードは使っていない想定の検証。
-- ここで止まった場合は手動で対処方針を決めること（勝手に消さない）。
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM "e_image_backend_v2" i
  WHERE i.user_id NOT IN (
    SELECT id FROM "e_user_backend" WHERE username = 'admin'
  );
  IF n > 0 THEN
    RAISE EXCEPTION 'aborting: % image(s) owned by non-admin or unknown users', n;
  END IF;
END $$;

-- 期限付き画像の件数を通知（新スタックに期限機能は無い。0 件想定の確認用）
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "e_image_backend_v2" WHERE expires_at IS NOT NULL;
  RAISE NOTICE 'images with expires_at set (expiry will NOT be migrated): %', n;
END $$;

-- ============================================================
-- 1. user（admin のみ残す）
-- ============================================================

ALTER TABLE "e_user_backend" RENAME TO "user";
-- guest 等は FK cascade で配下の usr_preference / apikey ごと消える
-- （所有画像が無いことはガード済み）
DELETE FROM "user" WHERE username <> 'admin';
ALTER TABLE "user" DROP COLUMN "roles";
ALTER TABLE "user" RENAME COLUMN "hashed_password" TO "password";
ALTER TABLE "user" ALTER COLUMN "username" TYPE text;
ALTER TABLE "user" ALTER COLUMN "password" TYPE text;
ALTER TABLE "user" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "user" RENAME CONSTRAINT "PK_0b9d256d52e55a48d32e8b64d96" TO "user_pkey";
ALTER TABLE "user" RENAME CONSTRAINT "UQ_ae538430fd08b28f4ab297eff09" TO "user_username_unique";
DROP INDEX "IDX_ae538430fd08b28f4ab297eff0";

-- ============================================================
-- 2. apikey（key は平文・無変換 — 既存 ShareX キーを生かす）
-- ============================================================

-- apikey だけはテーブル再作成。旧テーブルは "userId" が最後尾カラムで、
-- in-place RENAME ではカラム順がベースライン（user_id が 3 番目）と一致せず
-- pg_dump --schema-only の diff 検証が通らないため。行数は高々数件なので安価。
ALTER TABLE "e_api_key_backend" RENAME TO "apikey_old";
CREATE TABLE "apikey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used" timestamp with time zone,
	CONSTRAINT "apikey_key_unique" UNIQUE("key")
);
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
INSERT INTO "apikey" ("id", "key", "user_id", "name", "created", "last_used")
SELECT "id", "key", "userId", "name", "created", "last_used" FROM "apikey_old";
DROP TABLE "apikey_old";

-- ============================================================
-- 3. image（expires_at / delete_key は移植しない）
-- ============================================================

ALTER TABLE "e_image_backend_v2" RENAME TO "image";
ALTER TABLE "image" DROP COLUMN "expires_at";
ALTER TABLE "image" DROP COLUMN "delete_key";
ALTER TABLE "image" ALTER COLUMN "id" TYPE text;
ALTER TABLE "image" ALTER COLUMN "file_name" TYPE text;
ALTER TABLE "image" ALTER COLUMN "file_name" SET DEFAULT 'image';
ALTER TABLE "image" ALTER COLUMN "created" SET DEFAULT now();
ALTER TABLE "image" RENAME CONSTRAINT "PK_c227ae010c616ba910e5737ac03" TO "image_pkey";
-- 旧 v2 には user への FK が無かったので新設（ガードで整合性は確認済み）
ALTER TABLE "image" ADD CONSTRAINT "image_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;

-- ============================================================
-- 4. image_file
-- ============================================================

ALTER TABLE "e_image_file_backend_v2" RENAME TO "image_file";
ALTER TABLE "image_file" RENAME COLUMN "_id" TO "id";
ALTER TABLE "image_file" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "image_file" ALTER COLUMN "image_id" TYPE text;
ALTER TABLE "image_file" ALTER COLUMN "variant" TYPE text;
ALTER TABLE "image_file" ALTER COLUMN "filetype" TYPE text;
ALTER TABLE "image_file" RENAME CONSTRAINT "PK_677b08227794a2363554eed7268" TO "image_file_pkey";
ALTER TABLE "image_file" RENAME CONSTRAINT "UQ_303a57185f10a62447ebbdc2b7f" TO "image_file_image_id_variant_unique";
ALTER TABLE "image_file" RENAME CONSTRAINT "FK_9f7db4b32b0c34965ae32482faf" TO "image_file_image_id_image_id_fk";
ALTER TABLE "image_file" ADD CONSTRAINT "image_file_variant_check"
  CHECK ("image_file"."variant" in ('master', 'original'));
DROP INDEX "IDX_9f7db4b32b0c34965ae32482fa";
DROP INDEX "IDX_624c858cefb5429083b5c910fd";

-- ============================================================
-- 5. image_derivative（key 規約が非互換なので中身は捨てる。再生成可能）
-- ============================================================

ALTER TABLE "e_image_derivative_backend_v2" RENAME TO "image_derivative";
TRUNCATE "image_derivative";
ALTER TABLE "image_derivative" RENAME COLUMN "_id" TO "id";
ALTER TABLE "image_derivative" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "image_derivative" ALTER COLUMN "image_id" TYPE text;
ALTER TABLE "image_derivative" ALTER COLUMN "key" TYPE text;
ALTER TABLE "image_derivative" ALTER COLUMN "filetype" TYPE text;
ALTER TABLE "image_derivative" ALTER COLUMN "last_read" SET DEFAULT now();
ALTER TABLE "image_derivative" RENAME CONSTRAINT "PK_f00074bb7a7268d3227cdfbf452" TO "image_derivative_pkey";
ALTER TABLE "image_derivative" RENAME CONSTRAINT "UQ_d214dd07be2118996e900cff2d4" TO "image_derivative_image_id_key_unique";
ALTER TABLE "image_derivative" RENAME CONSTRAINT "FK_f7d74de2723367bde5ef284db6e" TO "image_derivative_image_id_image_id_fk";
DROP INDEX "IDX_f7d74de2723367bde5ef284db6";
DROP INDEX "IDX_c2daefe1e3cf2fdb84a6b1249b";

-- ============================================================
-- 6. settings（新規テーブル。admin の keep_original preference を統合）
-- ============================================================

CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"keep_original" boolean DEFAULT false NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
-- 旧 usr preference の value は文字列 'true' / 'false'
INSERT INTO "settings" ("id", "keep_original")
SELECT 1, (p.value = 'true')
FROM "e_usr_preference_backend" p
JOIN "user" u ON u.id = p.user_id
WHERE p.key = 'keep_original';
-- preference 行が無かった場合はデフォルト false で行を作る
INSERT INTO "settings" ("id", "keep_original")
VALUES (1, false)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. 旧テーブルの掃除
-- ============================================================

-- v1 残骸（0.6 で v2 に移行した後も DROP されず残っている場合がある）
DROP TABLE IF EXISTS "e_image_derivative_backend";
DROP TABLE IF EXISTS "e_image_file_backend";
DROP TABLE IF EXISTS "e_image_backend";
-- 役目を終えたテーブル
DROP TABLE "e_usr_preference_backend";
DROP TABLE "e_sys_preference_backend";
DROP TABLE "e_role_backend";
DROP TABLE "e_system_state_backend";
-- TypeORM の管理テーブル
DROP TABLE IF EXISTS "migrations";
DROP TABLE IF EXISTS "typeorm_metadata";

-- ============================================================
-- 8. 拡張の掃除（uuid_generate_v4 の default を全て置換済みなので不要）
-- ============================================================

DROP EXTENSION IF EXISTS "uuid-ossp";

COMMIT;
```

- [ ] **Step 2: 旧スキーマ fixture を作る（commit しない・/tmp に置く）**

リハーサル用に旧 DB の最終状態を再現する。`/tmp/kuv-old-fixture.sql` に保存:

```sql
-- 旧 Picsur DB の最終スキーマ再現（git 779a7e2 の archive migrations から再構成）+ サンプルデータ
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "e_user_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying NOT NULL, "roles" text array NOT NULL, "hashed_password" character varying NOT NULL, CONSTRAINT "UQ_ae538430fd08b28f4ab297eff09" UNIQUE ("username"), CONSTRAINT "PK_0b9d256d52e55a48d32e8b64d96" PRIMARY KEY ("id"));
CREATE INDEX "IDX_ae538430fd08b28f4ab297eff0" ON "e_user_backend" ("username");

CREATE TABLE "e_sys_preference_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "value" character varying NOT NULL, CONSTRAINT "UQ_b04e47c4814fb6e315c5879fa75" UNIQUE ("key"), CONSTRAINT "PK_b79f051e19b46e74cf255e9ba3b" PRIMARY KEY ("id"));
CREATE INDEX "IDX_b04e47c4814fb6e315c5879fa7" ON "e_sys_preference_backend" ("key");

CREATE TABLE "e_usr_preference_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "value" character varying NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "UQ_576678406a479d569123a33e132" UNIQUE ("key", "user_id"), CONSTRAINT "PK_8f8251016cd9283e7eb04c5498b" PRIMARY KEY ("id"), CONSTRAINT "FK_f1a427e855045fa793c275861a7" FOREIGN KEY ("user_id") REFERENCES "e_user_backend"("id") ON DELETE CASCADE);
CREATE INDEX "IDX_673fe530e2484ff7e31ac81099" ON "e_usr_preference_backend" ("key");
CREATE INDEX "IDX_f1a427e855045fa793c275861a" ON "e_usr_preference_backend" ("user_id");

CREATE TABLE "e_role_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "permissions" text array NOT NULL, CONSTRAINT "UQ_cbedb9f42a98a82d91422e7fedf" UNIQUE ("name"), CONSTRAINT "PK_af7ba6a46bf69a7b10c425f0367" PRIMARY KEY ("id"));
CREATE INDEX "IDX_cbedb9f42a98a82d91422e7fed" ON "e_role_backend" ("name");

CREATE TABLE "e_system_state_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "value" character varying NOT NULL, CONSTRAINT "UQ_f11f1605928b497b24f4b3ecc1f" UNIQUE ("key"), CONSTRAINT "PK_097ea165dadc8c14237481afd64" PRIMARY KEY ("id"));
CREATE INDEX "IDX_f11f1605928b497b24f4b3ecc1" ON "e_system_state_backend" ("key");

CREATE TABLE "e_api_key_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "name" character varying NOT NULL, "created" TIMESTAMP WITH TIME ZONE NOT NULL, "last_used" TIMESTAMP WITH TIME ZONE, "userId" uuid NOT NULL, CONSTRAINT "UQ_a244964afdff398bab8a45017c8" UNIQUE ("key"), CONSTRAINT "PK_e31f7dfe2db917a6ed1024f4e8b" PRIMARY KEY ("id"), CONSTRAINT "FK_3a32374df29b25152a84f0d1025" FOREIGN KEY ("userId") REFERENCES "e_user_backend"("id") ON DELETE CASCADE);
CREATE INDEX "IDX_a244964afdff398bab8a45017c" ON "e_api_key_backend" ("key");

CREATE TABLE "e_image_backend_v2" ("id" character varying NOT NULL, "user_id" uuid NOT NULL, "created" TIMESTAMP WITH TIME ZONE NOT NULL, "file_name" character varying NOT NULL DEFAULT 'image', "expires_at" TIMESTAMP WITH TIME ZONE, "delete_key" character varying, CONSTRAINT "PK_c227ae010c616ba910e5737ac03" PRIMARY KEY ("id"));

CREATE TABLE "e_image_file_backend_v2" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "image_id" character varying NOT NULL, "variant" character varying NOT NULL, "filetype" character varying NOT NULL, "data" bytea NOT NULL, CONSTRAINT "UQ_303a57185f10a62447ebbdc2b7f" UNIQUE ("image_id", "variant"), CONSTRAINT "PK_677b08227794a2363554eed7268" PRIMARY KEY ("_id"), CONSTRAINT "FK_9f7db4b32b0c34965ae32482faf" FOREIGN KEY ("image_id") REFERENCES "e_image_backend_v2"("id") ON DELETE CASCADE);
CREATE INDEX "IDX_9f7db4b32b0c34965ae32482fa" ON "e_image_file_backend_v2" ("image_id");
CREATE INDEX "IDX_624c858cefb5429083b5c910fd" ON "e_image_file_backend_v2" ("variant");

CREATE TABLE "e_image_derivative_backend_v2" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "image_id" character varying NOT NULL, "key" character varying NOT NULL, "filetype" character varying NOT NULL, "last_read" TIMESTAMP WITH TIME ZONE NOT NULL, "data" bytea NOT NULL, CONSTRAINT "UQ_d214dd07be2118996e900cff2d4" UNIQUE ("image_id", "key"), CONSTRAINT "PK_f00074bb7a7268d3227cdfbf452" PRIMARY KEY ("_id"), CONSTRAINT "FK_f7d74de2723367bde5ef284db6e" FOREIGN KEY ("image_id") REFERENCES "e_image_backend_v2"("id") ON DELETE CASCADE);
CREATE INDEX "IDX_f7d74de2723367bde5ef284db6" ON "e_image_derivative_backend_v2" ("image_id");
CREATE INDEX "IDX_c2daefe1e3cf2fdb84a6b1249b" ON "e_image_derivative_backend_v2" ("key");

-- v1 残骸（最低限の再現。移行 SQL の DROP IF EXISTS を通すため）
CREATE TABLE "e_image_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "created" TIMESTAMP WITH TIME ZONE NOT NULL, "file_name" character varying NOT NULL DEFAULT 'image', "expires_at" TIMESTAMP WITH TIME ZONE, "delete_key" character varying, CONSTRAINT "PK_5f7993001a7c82564ec5300540d" PRIMARY KEY ("id"));
CREATE TABLE "e_image_file_backend" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "image_id" uuid NOT NULL, "variant" character varying NOT NULL, "filetype" character varying NOT NULL, "data" bytea NOT NULL, CONSTRAINT "PK_95953be58a506e5de46feec6186" PRIMARY KEY ("_id"), CONSTRAINT "FK_8055f37d3b9f52f421b94ee84db" FOREIGN KEY ("image_id") REFERENCES "e_image_backend"("id") ON DELETE CASCADE);
CREATE TABLE "e_image_derivative_backend" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "image_id" uuid NOT NULL, "key" character varying NOT NULL, "filetype" character varying NOT NULL, "last_read" TIMESTAMP WITH TIME ZONE NOT NULL, "data" bytea NOT NULL, CONSTRAINT "PK_ff1ecff935b8d7bdcea89087810" PRIMARY KEY ("_id"), CONSTRAINT "FK_37055605f39b3f8847232d604f8" FOREIGN KEY ("image_id") REFERENCES "e_image_backend"("id") ON DELETE CASCADE);

-- TypeORM 管理テーブル
CREATE TABLE "migrations" ("id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" character varying NOT NULL);
INSERT INTO "migrations" ("timestamp", "name") VALUES (1678682897629, 'V060A1678682897629');

-- ---- サンプルデータ ----
INSERT INTO "e_user_backend" ("id", "username", "roles", "hashed_password") VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin', '{admin}', '$2b$10$dummyhashdummyhashdummyhashdummyhashdummyhashdummyha'),
  ('00000000-0000-4000-8000-000000000002', 'guest', '{guest}', '$2b$10$dummyhashdummyhashdummyhashdummyhashdummyhashdummyha');
INSERT INTO "e_usr_preference_backend" ("key", "value", "user_id") VALUES
  ('keep_original', 'true', '00000000-0000-4000-8000-000000000001');
INSERT INTO "e_sys_preference_backend" ("key", "value") VALUES ('jwt_secret', 'old-secret');
INSERT INTO "e_api_key_backend" ("key", "name", "created", "userId") VALUES
  ('abcdefghijklmnopqrstuvwxyz012345', '2023-01-01_1', now(), '00000000-0000-4000-8000-000000000001');
INSERT INTO "e_image_backend_v2" ("id", "user_id", "created", "file_name") VALUES
  ('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', '00000000-0000-4000-8000-000000000001', now(), 'test.png');
INSERT INTO "e_image_file_backend_v2" ("image_id", "variant", "filetype", "data") VALUES
  ('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'master', 'image/png', '\x89504e470d0a1a0a');
INSERT INTO "e_image_derivative_backend_v2" ("image_id", "key", "filetype", "last_read", "data") VALUES
  ('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'oldkey', 'image/webp', now(), '\x52494646');
```

- [ ] **Step 3: リハーサル — 使い捨て postgres で適用して RED/GREEN を見る**

```bash
docker run -d --name kuv-mig-test -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=old postgres:17-alpine
sleep 3
docker exec -i kuv-mig-test psql -U test -d old -v ON_ERROR_STOP=1 < /tmp/kuv-old-fixture.sql
docker exec -i kuv-mig-test psql -U test -d old -v ON_ERROR_STOP=1 < deploy/migrate-from-picsur.sql
```

Expected: fixture 適用が成功し、移行 SQL が `NOTICE: images with expires_at set (expiry will NOT be migrated): 0` を出して `COMMIT` まで通る。

- [ ] **Step 4: データ検証**

```bash
docker exec kuv-mig-test psql -U test -d old -c 'SELECT username FROM "user";' \
  -c 'SELECT count(*) AS apikeys FROM "apikey";' \
  -c 'SELECT count(*) AS images FROM "image";' \
  -c 'SELECT keep_original FROM "settings";' \
  -c 'SELECT count(*) AS derivatives FROM "image_derivative";' \
  -c "SELECT to_regclass('e_user_backend') IS NULL AS old_user_gone, to_regclass('migrations') IS NULL AS typeorm_gone;"
```

Expected: user = admin のみ / apikeys = 1 / images = 1 / keep_original = t / derivatives = 0 / old_user_gone = t / typeorm_gone = t。

- [ ] **Step 5: schema diff 検証（drizzle ベースラインと完全一致）**

```bash
docker exec kuv-mig-test createdb -U test baseline
docker exec -i kuv-mig-test psql -U test -d baseline -v ON_ERROR_STOP=1 < packages/shared/drizzle/0000_nostalgic_baron_zemo.sql
docker exec kuv-mig-test pg_dump -U test --schema-only baseline | grep -vE '^\\(un)?restrict' > /tmp/kuv-baseline.sql
docker exec kuv-mig-test pg_dump -U test --schema-only old | grep -vE '^\\(un)?restrict' > /tmp/kuv-migrated.sql
diff /tmp/kuv-baseline.sql /tmp/kuv-migrated.sql && echo "SCHEMA MATCH"
```

Expected: `SCHEMA MATCH`（diff 出力なし）。差分が出たら移行 SQL の constraint 名・型・default を修正して Step 3 からやり直す（コンテナは `docker rm -f kuv-mig-test` で作り直すのが確実）。

- [ ] **Step 6: ネガティブ検証 — ガードが効くことを確認**

guest 所有の画像を足した fixture で中断することを見る:

```bash
docker rm -f kuv-mig-test
docker run -d --name kuv-mig-test -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=old postgres:17-alpine
sleep 3
docker exec -i kuv-mig-test psql -U test -d old -v ON_ERROR_STOP=1 < /tmp/kuv-old-fixture.sql
docker exec kuv-mig-test psql -U test -d old -c "INSERT INTO \"e_image_backend_v2\" (\"id\", \"user_id\", \"created\") VALUES ('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '00000000-0000-4000-8000-000000000002', now());"
docker exec -i kuv-mig-test psql -U test -d old -v ON_ERROR_STOP=1 < deploy/migrate-from-picsur.sql; echo "exit=$?"
docker exec kuv-mig-test psql -U test -d old -c "SELECT to_regclass('e_user_backend') IS NOT NULL AS rolled_back;"
docker rm -f kuv-mig-test
```

Expected: `ERROR: aborting: 1 image(s) owned by non-admin or unknown users`、`exit=3`（非 0）、`rolled_back = t`（全ロールバックで旧テーブルが無傷）。

- [ ] **Step 7: Commit**

```bash
git add deploy/migrate-from-picsur.sql
git commit -m "feat(deploy): 旧 Picsur DB を kuv スキーマへ in-place 移行する SQL"
```

---

### Task 4: `deploy/MIGRATION.md` — CT セットアップ + 移行手順書

**Files:**
- Create: `deploy/MIGRATION.md`

- [ ] **Step 1: 手順書を書く**

機微情報なし（値は全てプレースホルダか生成コマンド）。全文:

````markdown
# 旧 Picsur CT → kuv 新 CT への blue-green 移行手順

方針: 旧 CT・旧 DB には一切書き込まない（pg_dump の読み取り一度きり）。
新 CT 側のコピーに移行 SQL を適用し、nginx proxy manager (NPM) の切り替えだけで
移行・ロールバックを行う。設計の経緯は
`docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「Phase 5 の移行戦略」を参照。

## 1. 新 CT の作成

Proxmox で新規 CT を作成（Debian 12 以降を想定）。以下をインストール:

```bash
apt-get update && apt-get install -y git docker.io docker-compose-plugin curl
git clone https://github.com/e-jigsaw/Picsur.git /opt/kuv
cd /opt/kuv && git checkout hack
```

## 2. env の用意

```bash
cd /opt/kuv
cat > .env <<EOF
KUV_JWT_SECRET=$(openssl rand -hex 48)
EOF
chmod 600 .env
```

`.env` は docker compose が自動で読む。DB の host/user/password/database は
compose 内で完結している（すべて `kuv`、外部非公開）ので設定不要。

## 3. 新スタックの起動確認（空 DB でのスモーク）

```bash
docker compose up -d --build
# スキーマ適用（migration runner は無いので psql で直接）
docker compose exec -T postgres psql -U kuv -d kuv -v ON_ERROR_STOP=1 \
  < packages/shared/drizzle/0000_nostalgic_baron_zemo.sql
curl -sf http://localhost:8080/ | head -3        # SPA の HTML が返る
curl -s  http://localhost:8080/api/auth/me       # 401 JSON が返る
```

両方返れば caddy / api / postgres の配線は正常。

## 4. 旧 CT から pg_dump を取得（読み取りのみ）

旧 CT 上で（DB 名・ユーザ名は旧 CT の環境変数 `PICSUR_DB_*` を参照。デフォルトは `picsur`）:

```bash
pg_dump -U <旧DBユーザ> -Fc <旧DB名> > /tmp/picsur.dump
```

新 CT へ転送:

```bash
scp <旧CTホスト>:/tmp/picsur.dump /opt/kuv/picsur.dump
```

## 5. 新 CT で restore（kuv DB を作り直してから）

```bash
cd /opt/kuv
docker compose stop api                  # restore 中の書き込みを防ぐ
docker compose exec postgres dropdb -U kuv kuv
docker compose exec postgres createdb -U kuv kuv
docker compose exec -T postgres pg_restore -U kuv -d kuv --no-owner --no-privileges \
  < picsur.dump
```

`--no-owner --no-privileges` は必須（旧 DB の role 名は新 postgres に存在しない）。

## 6. 移行 SQL の適用

```bash
docker compose exec -T postgres psql -U kuv -d kuv -v ON_ERROR_STOP=1 \
  < deploy/migrate-from-picsur.sql
```

- 全体が 1 トランザクション。エラーで止まったら何も変わっていない（再試行は原因を直してから同じコマンドでよい）。
- `NOTICE: images with expires_at set ...: 0` を確認（0 でなければ期限付き画像が存在する。期限は移行されないことを了解の上で進めるか判断）。
- `ERROR: aborting: N image(s) owned by non-admin ...` で止まった場合は admin 以外の所有画像がある。対処を決めてから再実行（勝手に消さない）。

## 7. schema diff 検証

移行結果が drizzle ベースラインと完全一致することを機械的に確認する:

```bash
docker compose exec postgres createdb -U kuv baseline
docker compose exec -T postgres psql -U kuv -d baseline -v ON_ERROR_STOP=1 \
  < packages/shared/drizzle/0000_nostalgic_baron_zemo.sql
docker compose exec postgres pg_dump -U kuv --schema-only baseline | grep -vE '^\\(un)?restrict' > /tmp/baseline.sql
docker compose exec postgres pg_dump -U kuv --schema-only kuv      | grep -vE '^\\(un)?restrict' > /tmp/migrated.sql
diff /tmp/baseline.sql /tmp/migrated.sql && echo "SCHEMA MATCH"
docker compose exec postgres dropdb -U kuv baseline
```

`SCHEMA MATCH` が出なければ差分を確認して止まる（diff の内容が対処方針の判断材料になる）。

## 8. 動作確認チェックリスト

```bash
docker compose start api
```

- [ ] `http://<新CTホスト>:8080/` で SPA が開く
- [ ] 旧パスワードで admin ログインできる
- [ ] 画像一覧に既存画像が出る・クリックして表示できる（`GET /i/<id>` が 200）
- [ ] 既存の ShareX apikey でアップロードできる:
  ```bash
  curl -s -H "Authorization: Api-Key <既存キー>" \
    -F "file=@/tmp/test.png" http://localhost:8080/api/image
  ```
- [ ] settings 画面の keep_original が旧設定値と一致している

## 9. NPM の切り替え

nginx proxy manager の該当 proxy host の転送先を
`<旧CTホスト>:<旧ポート>` → `<新CTホスト>:8080` に変更。

## 10. 様子見と旧 CT の停止

- 数日〜1週間ほど通常利用して問題ないことを確認
- **ロールバック**: NPM の転送先を旧 CT に戻すだけ（旧系統は無傷で並走している）
- 問題なければ旧 CT を停止（Proxmox 上で shutdown。削除はさらに様子を見てから）
````

- [ ] **Step 2: 手順書内のコマンド整合チェック**

以下を目視確認:
- migration ファイル名 `0000_nostalgic_baron_zemo.sql` が `packages/shared/drizzle/` の実ファイル名と一致（`ls packages/shared/drizzle/`）
- compose のサービス名（`postgres` / `api` / `caddy`）と port `8080:80` が `docker-compose.yml` と一致
- repo URL が `git remote get-url origin` と一致

- [ ] **Step 3: Commit**

```bash
git add deploy/MIGRATION.md
git commit -m "docs(deploy): 旧 Picsur CT からの blue-green 移行手順書"
```

---

### Task 5: 仕上げ — push と進捗記録

- [ ] **Step 1: 全体検証**

```bash
pnpm -r test && pnpm -r typecheck && pnpm -r build
```

Expected: 全部緑（既存 129 テスト。本 plan はアプリコードに触れないので回帰しないはずだが確認する）。

- [ ] **Step 2: push**

```bash
git push origin hack
```

- [ ] **Step 3: Vikunja に進捗コメント**

Vikunja task id=332（project 68「Picsur メンテ」#8）にコメントを残す。**Done にはしない**（実際の CT 移行が残っているため）。内容: 成果物 3 点（web self-contained 化 / 移行 SQL / MIGRATION.md）が完成しリハーサル済み、残りは MIGRATION.md に沿った実 CT での作業のみ、という旨。

- [ ] **Step 4: plan 末尾に実装完了メモを追記**

本ファイル末尾に「実装完了メモ」セクションを追記し、検証結果（schema diff、ネガティブ検証、スモーク）と次にやること（実 CT での MIGRATION.md 実施）を記録してコミット。

```bash
git add docs/superpowers/plans/2026-06-07-kuv-phase5-deploy.md
git commit -m "docs: phase 5 デプロイ成果物 plan に実装完了メモを追記"
git push origin hack
```
