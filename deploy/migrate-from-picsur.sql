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
-- dump に admin がいない等で user が空になったらここで中断（fail-closed）
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "user";
  IF n <> 1 THEN
    RAISE EXCEPTION 'aborting: expected exactly 1 user (admin) after cleanup, found %', n;
  END IF;
END $$;
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

-- ------------------------------------------------------------
-- 4a. variant 意味の差を吸収する
-- ------------------------------------------------------------
-- Picsur と kuv で image_file の variant 意味が異なる:
--   Picsur: master = QOI ロスレス保管, original = 実アップロード画像
--   kuv:    master = 配信用の supported 形式(png/jpeg/webp/gif), original = 生アップロード
-- kuv の配信(/i)は master しか読まず、libvips は QOI を読めない。
-- そこで「Picsur の original を kuv の master に昇格」する。

-- MIME 表記を Picsur の 'image:xxx'（コロン）から kuv の 'image/xxx'（スラッシュ）へ。
UPDATE "image_file" SET "filetype" = replace("filetype", 'image:', 'image/');

-- original を持つ画像については QOI master を捨てる（後で original 由来の master を作る）。
-- original を持たない画像（QOI master のみ）の QOI は残す → 移行後に別途 PNG 救出する。
DELETE FROM "image_file" m
WHERE m."variant" = 'master'
  AND m."filetype" = 'image/qoi'
  AND EXISTS (
    SELECT 1 FROM "image_file" o
    WHERE o."image_id" = m."image_id" AND o."variant" = 'original'
  );

-- original を master として複製（配信用）。original 行は keep_original 用に残す。
INSERT INTO "image_file" ("id", "image_id", "variant", "filetype", "data")
SELECT gen_random_uuid(), "image_id", 'master', "filetype", "data"
FROM "image_file" WHERE "variant" = 'original';

-- file 行が 1 つも無い画像（Picsur 側で実体が消えた reject 残骸）は配信不能なので削除。
-- QOI master のみの画像は master 行が残るので、ここでは消えない（救出対象として残す）。
DELETE FROM "image" i
WHERE NOT EXISTS (
  SELECT 1 FROM "image_file" f WHERE f."image_id" = i."id"
);

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
-- value は 'true' / 'false' の文字列のはず。想定外の値なら静かに false に倒さず中断
DO $$
DECLARE v text;
BEGIN
  SELECT p.value INTO v
  FROM "e_usr_preference_backend" p
  JOIN "user" u ON u.id = p.user_id
  WHERE p.key = 'keep_original';
  IF v IS NOT NULL AND v NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'aborting: unexpected keep_original value %', quote_literal(v);
  END IF;
END $$;
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
