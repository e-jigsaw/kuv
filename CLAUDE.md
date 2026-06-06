# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

kuv は self-hosted image host（Imgur/Pastebin のあいのこ）。upstream [Picsur](https://github.com/CaramelFur/Picsur) の fork を Hono + Drizzle + Vike で全面書き直したもの（旧名 Picsur、2026-06 に改名）。設計は `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md`、リネーム経緯は `docs/superpowers/specs/2026-06-07-kuv-rename-design.md` を参照。旧 NestJS/Angular 実装は削除済み（git 履歴 `779a7e2` 時点の `archive/` にある）。

## Workspace layout

pnpm workspace（Node 24、mise 管理）:

- `packages/shared`（`@kuv/shared`）— Drizzle スキーマ、DTO、定数。drizzle-kit の設定もここ（`drizzle.config.ts`）。
- `packages/api`（`@kuv/api`）— Hono API サーバ。dev は tsx watch、ビルドは tsup。
- `packages/web`（`@kuv/web`）— Vike + React SPA、Tailwind CSS。

## Commands

```bash
pnpm install
pnpm dev:api          # API dev server
pnpm dev:web          # web dev server
pnpm test             # 全 workspace のテスト (pnpm -r)
pnpm typecheck
pnpm build
```

開発用 Postgres は `docker compose up -d postgres`（db/user/pass すべて `kuv`、port 5432）。

## Environment

env の読み取りは `packages/api/src/env.ts` に集約されている。`KUV_JWT_SECRET`（必須）、`KUV_DB_{HOST,PORT,USER,PASSWORD,DATABASE}`（デフォルト: localhost / 5432 / kuv / kuv / kuv）。

## Notes

- 認証は JWT cookie（`kuv_jwt`、`packages/api/src/middleware/auth.ts`）と API key ヘッダ。
- 画像バイナリは Postgres に格納（ディスクではない）。
- デプロイは docker-compose（Caddy + api + postgres）。稼働中の旧 Picsur CT からの blue-green 移行手順は rewrite-design spec の「Phase 5 の移行戦略」を参照。
