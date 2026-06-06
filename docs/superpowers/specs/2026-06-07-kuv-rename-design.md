# Picsur → kuv リネーム + archive 掃除 設計

2026-06-07

## 背景と目的

リライト（Hono + Drizzle + Vike monorepo）でコードベースはほぼ全面的に書き換わったため、プロジェクト名を Picsur から **kuv**（フィンランド語 kuva = 画像、を 3 文字に切り詰めた造語）に変更する。あわせて参照専用に残していた旧実装 `archive/` を削除する。

名前の選定経緯: 造語・LLM フレンドリーなユニーク名を基準に候補を比較。npm / GitHub / Web を確認し、kuv は同名の目立つソフトウェアプロジェクトが無いことを確認済み（npm `kuv` はプレースホルダで使用済みだが、workspace パッケージは publish しないため実害なし）。

## タイミング

**Phase 5（blue-green での新 CT デプロイ）の前に実施する。**

新 CT を最初から kuv として立てることで、稼働中の旧 Picsur CT に一切手を入れずに名前を切り替えられる。cookie 名変更によるセッション切れも新規デプロイなので無風。旧 CT の `pg_dump` は新 CT 側の `kuv` データベースに restore する。

## 1. コードのリネーム（hack ブランチ上で一括）

- パッケージ: `@picsur/{shared,api,web}` → `@kuv/{shared,api,web}`、全 import 書き換え
- env: `PICSUR_JWT_SECRET` → `KUV_JWT_SECRET`、`PICSUR_DB_*` → `KUV_DB_*`
- DB デフォルト: user / password / database の `picsur` → `kuv`
- cookie: `picsur_jwt` → `kuv_jwt`
- docker-compose / Caddyfile / README / CLAUDE.md を kuv 前提に書き換え

### そのまま残すもの

- `docs/superpowers/` 配下の過去 plan / spec — 日付付きの履歴のため改名・改稿しない
- `LICENSE`（AGPL v3）— スキーマも移行データも v2 由来のため維持

## 2. 不要物の削除（リネームとは別コミット)

- `archive/` 削除 — `779a7e2` でコミット済みのため git 履歴から参照可能。CLAUDE.md の archive 言及も整理
- `branding/` 削除 — 旧 Picsur のロゴ・テキスト類。kuv のロゴは必要になったら別件

## 3. リポジトリ名

- GitHub: `e-jigsaw/Picsur` → `e-jigsaw/kuv`（旧 URL は GitHub が redirect）
- ローカル: `~/dev/github.com/e-jigsaw/Picsur` → `~/dev/github.com/e-jigsaw/kuv`、remote URL 更新

## 4. 実施順序

1. リネームコミット（§1）
2. 削除コミット（§2）
3. GitHub repo 改名 + ローカルディレクトリ改名（§3）
4. Phase 5: 新 CT を kuv として構築（blue-green 手順の DB 名を kuv 前提に追記）

## 検証

- `pnpm -r test` / `pnpm -r typecheck` / `pnpm -r build` が全て通ること
- リポジトリ内に意図しない `picsur` 残存が無いこと（`grep -ri picsur` で docs/superpowers 配下以外ゼロ）
- docker-compose がローカルで起動し、`KUV_*` env で API が立ち上がること

## 非対象

- kuv の新ロゴ・ブランディング作成
- Phase 5 のデプロイ作業そのもの（既存スペックの範囲）
- npm への publish
