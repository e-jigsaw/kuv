# Picsur → kuv リネーム + archive 掃除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロジェクト名を Picsur から kuv に全面リネームし、旧実装 `archive/` と旧ブランディング `branding/` を削除する。

**Architecture:** 機械的リネームなので新規テストは書かない。既存テストスイート (`pnpm -r test` / `typecheck` / `build`) を各タスク後のセーフティネットとして使う。置換は 4 カテゴリ (`@picsur/` → `@kuv/`、`PICSUR_` → `KUV_`、`picsur_jwt` → `kuv_jwt`、残りの単語 `picsur` → `kuv`) を一括適用。`docs/superpowers/` 配下の過去 plan/spec と `LICENSE` (AGPL v3) は変更しない。

**Tech Stack:** pnpm workspace / perl ワンライナー / gh CLI

**Spec:** `docs/superpowers/specs/2026-06-07-kuv-rename-design.md`

**前提:** repo: `/Users/jigsaw/dev/github.com/e-jigsaw/Picsur`、branch: `hack`、作業ツリーはクリーンであること。

---

### Task 1: コード一括リネーム

**Files:**
- Modify: `package.json`, `docker-compose.yml`, `packages/api/Dockerfile`, `packages/*/package.json`
- Modify: `packages/api/tsup.config.ts`, `packages/api/src/env.ts`, `packages/shared/drizzle.config.ts`, `packages/api/src/middleware/auth.ts` ほか `@picsur/shared` を import する ts ファイル約 15 件
- Regenerate: `pnpm-lock.yaml`

- [ ] **Step 1: 4 カテゴリの置換を一括適用**

```bash
cd /Users/jigsaw/dev/github.com/e-jigsaw/Picsur
git ls-files -z 'packages/**' package.json docker-compose.yml Caddyfile | \
  xargs -0 perl -pi -e 's/\@picsur\//\@kuv\//g; s/PICSUR_/KUV_/g; s/picsur_jwt/kuv_jwt/g; s/\bpicsur\b/kuv/g;'
```

対象は git 管理下の `packages/`・root `package.json`・`docker-compose.yml`・`Caddyfile` のみ。`archive/`・`branding/`・`docs/`・`README.md`・`CLAUDE.md`・`LICENSE` は触らない (README/CLAUDE.md は Task 3 で全面書き換え)。

- [ ] **Step 2: 置換漏れと意図しない置換がないか確認**

```bash
grep -rn -i picsur packages package.json docker-compose.yml Caddyfile pnpm-workspace.yaml mise.toml tsconfig.base.json
```

Expected: `pnpm-lock.yaml` 以外ヒットなし (exit 1 か、lock のみ)。perl は小文字 `picsur` 系のみ置換するので、コメント等に大文字 `Picsur` が残っていたらここで検出される — 文脈を見て手で `kuv` に直す (upstream Picsur への言及なら残す)。

```bash
git diff --stat
```

Expected: 約 30 ファイル変更。`docs/` 配下と `LICENSE` が含まれて**いない**こと。

- [ ] **Step 3: lockfile を再生成**

```bash
pnpm install
git diff --name-only pnpm-lock.yaml
```

Expected: `pnpm install` が成功し、`pnpm-lock.yaml` の importers が `@kuv/*` に更新される。

- [ ] **Step 4: テスト・型チェック・ビルドで回帰確認**

```bash
pnpm -r test && pnpm -r typecheck && pnpm -r build
```

Expected: すべて PASS。cookie 名のテスト (`packages/api/src/routes/auth.test.ts` の `kuv_jwt=` 期待) も置換で同期しているので通る。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor!: rename Picsur to kuv (packages, env vars, cookie, db defaults)"
```

---

### Task 2: archive/ と branding/ の削除

**Files:**
- Delete: `archive/` (旧 NestJS/Angular 実装、`779a7e2` でコミット済みのため git 履歴から参照可)
- Delete: `branding/` (旧 Picsur ロゴ・テキスト類)

- [ ] **Step 1: 削除**

```bash
git rm -r -q archive branding
```

- [ ] **Step 2: コード側に archive/branding への参照が残っていないか確認**

```bash
grep -rn "archive/\|branding/" packages package.json docker-compose.yml Caddyfile packages/api/Dockerfile
```

Expected: ヒットなし (exit 1)。README.md の `branding/logo/picsur.svg` 参照は Task 3 の全面書き換えで消える。

- [ ] **Step 3: ビルドが壊れていないか確認**

```bash
pnpm -r test && pnpm -r typecheck
```

Expected: すべて PASS。

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove archived legacy implementation and old branding"
```

---

### Task 3: README.md / CLAUDE.md の全面書き換え

**Files:**
- Rewrite: `README.md` (現状は upstream Picsur の README のまま)
- Rewrite: `CLAUDE.md` (現状は archive の旧アーキテクチャ説明が主体)

- [ ] **Step 1: README.md を以下の内容で全置換**

````markdown
# kuv

Self-hosted image host。Imgur と Pastebin のあいのこ。

[Picsur](https://github.com/CaramelFur/Picsur) の fork を Hono + Drizzle + Vike で全面的に書き直したもの（旧名 Picsur、2026-06 に改名）。

## Stack

- **API**: Hono + Drizzle ORM (Node 24)
- **Web**: Vike + React SPA + Tailwind CSS
- **DB**: Postgres（画像バイナリも DB に格納）
- **Deploy**: docker-compose（Caddy + api + postgres）
- **Tooling**: mise + pnpm workspace

## Development

```bash
mise install                    # Node 24 / pnpm
pnpm install
docker compose up -d postgres   # 開発用 DB
pnpm dev:api                    # Hono API (tsx watch)
pnpm dev:web                    # Vike dev server
```

テスト・型チェック・ビルド:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Environment

| 変数 | 必須 | デフォルト |
|---|---|---|
| `KUV_JWT_SECRET` | ✓ | — |
| `KUV_DB_HOST` | | `localhost` |
| `KUV_DB_PORT` | | `5432` |
| `KUV_DB_USER` | | `kuv` |
| `KUV_DB_PASSWORD` | | `kuv` |
| `KUV_DB_DATABASE` | | `kuv` |

## Deployment

`KUV_JWT_SECRET` を渡して `docker compose up -d`。構成と blue-green 移行手順は `docs/superpowers/specs/` を参照。

## License

AGPL-3.0（upstream Picsur 由来）
````

- [ ] **Step 2: CLAUDE.md を以下の内容で全置換**

````markdown
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
````

- [ ] **Step 3: リポジトリ全体の picsur 残存チェック**

```bash
cd /Users/jigsaw/dev/github.com/e-jigsaw/Picsur
grep -rli picsur . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs --exclude=pnpm-lock.yaml
```

Expected: `README.md` と `CLAUDE.md` のみ（upstream への言及・旧名の注記として意図的に残すもの）。それ以外が出たら置換漏れなので修正する。

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: rewrite README and CLAUDE.md for kuv"
```

---

### Task 4: rewrite-design spec の Phase 5 手順に DB 名を追記

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md:180-191` (「Phase 5 の移行戦略」セクション)

- [ ] **Step 1: blue-green 手順の末尾に追記**

「Phase 5 の移行戦略」セクションの本文末尾（`この方式により、…` の段落の後）に以下を追記する:

```markdown

**kuv リネーム後の補足（2026-06-07）:** プロジェクトは kuv に改名済み（`docs/superpowers/specs/2026-06-07-kuv-rename-design.md`）。新 CT は最初から kuv として構築する — env は `KUV_*`、postgres の db/user は `kuv`、`pg_dump` の restore 先も `kuv` データベース。
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md
git commit -m "docs: note kuv naming in phase 5 blue-green procedure"
```

---

### Task 5: 最終検証

- [ ] **Step 1: フルチェック**

```bash
cd /Users/jigsaw/dev/github.com/e-jigsaw/Picsur
pnpm -r test && pnpm -r typecheck && pnpm -r build
```

Expected: すべて PASS。

- [ ] **Step 2: compose 設定の妥当性確認**

```bash
KUV_JWT_SECRET=dummy docker compose config --quiet && echo OK
```

Expected: `OK`（未定義変数や構文エラーなし）。

- [ ] **Step 3: 旧ローカル DB volume の破棄**

既存の `db-data` volume は `picsur` 名で初期化されており、postgres イメージは空 volume でしか `POSTGRES_DB: kuv` を初期化しないため破棄する（ローカル開発用 DB。消えて困るデータが入っていないか、実行前にユーザに確認する）。

```bash
docker compose down -v
```

- [ ] **Step 4: compose で実起動して API の生存確認**

web の `dist/client` は Step 1 の `pnpm -r build` で生成済みであること。

```bash
KUV_JWT_SECRET=dummy docker compose up -d --build
sleep 5
curl -fsS http://localhost:8080/api/health
docker compose down
```

Expected: `{"ok":true}`。

- [ ] **Step 5: 残存 grep の最終確認**

```bash
grep -rli picsur . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs --exclude=pnpm-lock.yaml
```

Expected: `README.md` `CLAUDE.md` のみ。

---

### Task 6: リポジトリ改名（GitHub + ローカル）

外向きの操作なので**実行前にユーザに確認**する。

- [ ] **Step 1: GitHub repo を改名**

```bash
gh repo rename kuv -R e-jigsaw/Picsur --yes
```

Expected: `e-jigsaw/Picsur` → `e-jigsaw/kuv`。旧 URL は GitHub が redirect する。

- [ ] **Step 2: push して remote の追従を確認**

```bash
cd /Users/jigsaw/dev/github.com/e-jigsaw/Picsur
git remote set-url origin https://github.com/e-jigsaw/kuv.git
git push origin hack
```

Expected: push 成功。

- [ ] **Step 3: ローカルディレクトリを改名**

```bash
cd /Users/jigsaw/dev/github.com/e-jigsaw
mv Picsur kuv
cd kuv && git status -sb
```

Expected: `## hack...origin/hack` でクリーン。

注意: この step 以降、旧パス `/Users/jigsaw/dev/github.com/e-jigsaw/Picsur` を参照しているシェルやエディタは開き直しが必要。
