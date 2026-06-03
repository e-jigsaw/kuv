# Picsur Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧 Picsur のコードを `archive/` へ退避し、Node 24 / pnpm workspace の 3 パッケージ（shared / api / web）walking skeleton と Caddy + docker-compose の雛形を立ち上げる。ビルド・dev サーバ起動・テストが全部緑になる状態がゴール。

**Architecture:** pnpm workspace 分割モノレポ。`packages/api` は Hono、`packages/web` は Vike(SPA) + React + Tailwind、`packages/shared` は共有コード。前段 Caddy が `/api`・`/i` を api に、それ以外を web 静的配信に振る。

**Tech Stack:** Node 24 (mise), pnpm, Hono, `@hono/node-server`, Vike + vike-react, React 19, Tailwind v4, Vitest, tsup, Caddy, Docker Compose, Postgres 17。

このプランは spec `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「実装フェーズ 1（足場）」に対応する。schema / 認証 / 画像パイプライン / web ページ本体 / 実 DB 移行は後続プラン（shared / api / web / deploy）で扱う。

---

## File Structure

作成・変更するファイルと責務:

- `archive/` — 旧 `backend/` `frontend/` `shared/` `support/` の退避先（参照専用、ビルド対象外）
- `mise.toml` — Node 24 + pnpm のツール固定
- `pnpm-workspace.yaml` — workspace 定義
- `package.json`（root） — workspace スクリプト集約（旧 yarn 版を置換）
- `tsconfig.base.json` — 全パッケージ共通の strict TS 設定（旧版を置換）
- `packages/shared/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}` — 共有コード骨組み
- `packages/api/{package.json,tsconfig.json,tsup.config.ts,src/app.ts,src/server.ts,src/app.test.ts,Dockerfile}` — Hono サーバ骨組み
- `packages/web/{package.json,tsconfig.json,vite.config.ts,pages/+config.ts,pages/+Layout.tsx,pages/tailwind.css,pages/index/+Page.tsx}` — Vike SPA 骨組み
- `Caddyfile` — リバプロ設定
- `docker-compose.yml` — caddy + api + postgres
- `CLAUDE.md` — 書き直し中である旨に更新
- `.gitignore` — pnpm/vite/dist の無視追記

---

## Task 1: 旧コードを archive へ退避し yarn 系を撤去

**Files:**
- Move: `backend/` `frontend/` `shared/` `support/` → `archive/`
- Remove: `yarn.lock` `.yarnrc.yml` `.yarn/` `.nvmrc`
- Modify: `package.json` `tsconfig.base.json`（次タスクで置換するため、ここでは旧内容のまま移動しない＝root に残す）

- [ ] **Step 1: 旧アプリコードを archive/ へ移動**

```bash
mkdir -p archive
git mv backend archive/backend
git mv frontend archive/frontend
git mv shared archive/shared
git mv support archive/support
```

- [ ] **Step 2: yarn / 旧ランタイム固定ファイルを削除**

```bash
git rm -r --quiet .yarn
git rm --quiet yarn.lock .yarnrc.yml .nvmrc
```

- [ ] **Step 3: 退避できたか確認**

Run: `ls archive && ls`
Expected: `archive` に `backend frontend shared support` が在り、repo 直下から `backend/` 等が消えている。`.yarn` `yarn.lock` `.yarnrc.yml` `.nvmrc` が無い。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: archive legacy code and drop yarn tooling"
```

---

## Task 2: pnpm workspace / mise / 共通 TS 設定

**Files:**
- Create: `mise.toml`
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`（root, 旧 yarn 版を全置換）
- Modify: `tsconfig.base.json`（旧版を全置換）
- Modify: `.gitignore`

- [ ] **Step 1: mise.toml を作成**

```toml
[tools]
node = "24"
pnpm = "10"
```

- [ ] **Step 2: pnpm-workspace.yaml を作成**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: root package.json を置換**

```json
{
  "name": "picsur",
  "version": "0.6.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.4.1",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev:api": "pnpm --filter @picsur/api dev",
    "dev:web": "pnpm --filter @picsur/web dev"
  }
}
```

- [ ] **Step 4: tsconfig.base.json を置換**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": []
  }
}
```

- [ ] **Step 5: .gitignore に追記**

`.gitignore` の末尾へ以下を追加:

```
# pnpm / build outputs
node_modules/
dist/
.vite/
*.tsbuildinfo
```

- [ ] **Step 6: pnpm install が通るか確認**

Run: `mise install && pnpm install`
Expected: Node 24 / pnpm 10 が入り、`pnpm install`（まだパッケージは空だが）がエラー無く完了。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: set up pnpm workspace, mise (node24), base tsconfig"
```

---

## Task 3: shared パッケージ骨組み（TDD）

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

- [ ] **Step 1: package.json を作成**

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
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: 失敗するテストを書く**

`packages/shared/src/index.test.ts`:

```ts
import { expect, test } from "vitest";
import { PICSUR_VERSION } from "./index";

test("exposes the app version", () => {
  expect(PICSUR_VERSION).toBe("0.6.0");
});
```

- [ ] **Step 4: 依存を入れてテストが失敗するのを確認**

Run: `pnpm install && pnpm --filter @picsur/shared test`
Expected: FAIL（`./index` に `PICSUR_VERSION` が無い / モジュール解決エラー）

- [ ] **Step 5: 最小実装**

`packages/shared/src/index.ts`:

```ts
export const PICSUR_VERSION = "0.6.0";
```

- [ ] **Step 6: テストが通るのを確認**

Run: `pnpm --filter @picsur/shared test`
Expected: PASS（1 test）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shared): scaffold shared package with version export"
```

---

## Task 4: api パッケージ（Hono health エンドポイント, TDD）

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/tsup.config.ts`
- Create: `packages/api/src/app.ts`
- Create: `packages/api/src/server.ts`
- Test: `packages/api/src/app.test.ts`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "@picsur/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "hono": "^4.6.0",
    "@picsur/shared": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "outDir": "dist"
  },
  "include": ["src", "tsup.config.ts"]
}
```

- [ ] **Step 3: tsup.config.ts を作成**

native 依存が無い間は shared / hono をバンドルして runtime を依存ゼロにする（sharp/pg を足す deploy フェーズで見直す）:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  noExternal: [/@picsur\/shared/, /^hono/, /@hono\/node-server/],
});
```

- [ ] **Step 4: 失敗するテストを書く**

`packages/api/src/app.test.ts`:

```ts
import { expect, test } from "vitest";
import { app } from "./app";

test("GET /api/health returns ok", async () => {
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 5: テストが失敗するのを確認**

Run: `pnpm install && pnpm --filter @picsur/api test`
Expected: FAIL（`./app` が存在しない）

- [ ] **Step 6: Hono アプリを実装**

`packages/api/src/app.ts`:

```ts
import { Hono } from "hono";

export const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));
```

- [ ] **Step 7: テストが通るのを確認**

Run: `pnpm --filter @picsur/api test`
Expected: PASS（1 test）

- [ ] **Step 8: Node サーバのエントリを実装**

`packages/api/src/server.ts`:

```ts
import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
```

- [ ] **Step 9: dev サーバ起動とビルドを確認**

Run: `pnpm --filter @picsur/api build`
Expected: `packages/api/dist/server.js` が生成される。

Run: `node packages/api/dist/server.js & sleep 1 && curl -s localhost:3001/api/health && kill %1`
Expected: `{"ok":true}` が返る。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): scaffold Hono server with health endpoint"
```

---

## Task 5: web パッケージ（Vike SPA + React + Tailwind）

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/pages/+config.ts`
- Create: `packages/web/pages/+Layout.tsx`
- Create: `packages/web/pages/tailwind.css`
- Create: `packages/web/pages/index/+Page.tsx`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "@picsur/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vike build",
    "preview": "vike preview",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@picsur/shared": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vike": "^0.4.0",
    "vike-react": "^0.6.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["pages", "vite.config.ts"]
}
```

- [ ] **Step 3: vite.config.ts を作成**

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vike from "vike/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), vike(), tailwindcss()],
});
```

- [ ] **Step 4: Vike を SPA モードに設定**

`packages/web/pages/+config.ts`:

```ts
import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

// 全ページ SPA（SSR オフ）。完全プライベートなので SSR は不要。
export default {
  ssr: false,
  extends: vikeReact,
} satisfies Config;
```

- [ ] **Step 5: Tailwind エントリ CSS を作成**

`packages/web/pages/tailwind.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 6: 既定レイアウトを作成（Tailwind 読み込み）**

`packages/web/pages/+Layout.tsx`:

```tsx
import type { ReactNode } from "react";
import "./tailwind.css";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {children}
    </div>
  );
}
```

- [ ] **Step 7: トップページを作成**

`packages/web/pages/index/+Page.tsx`:

```tsx
export default function Page() {
  return <h1 className="p-8 text-2xl font-bold">Picsur</h1>;
}
```

- [ ] **Step 8: 依存を入れてビルドを確認**

Run: `pnpm install && pnpm --filter @picsur/web build`
Expected: `packages/web/dist/client/` に静的成果物（`index.html` 含む）が生成される。

- [ ] **Step 9: dev サーバ起動を確認**

Run: `pnpm --filter @picsur/web dev &` → ブラウザ/`curl -s localhost:3000` で確認 → 停止
Expected: Vite dev サーバが起動し、`Picsur` 見出しのページが配信される（Tailwind クラスが効いている）。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold Vike SPA with React and Tailwind"
```

---

## Task 6: Caddy + docker-compose + api Dockerfile

**Files:**
- Create: `Caddyfile`
- Create: `docker-compose.yml`
- Create: `packages/api/Dockerfile`

- [ ] **Step 1: Caddyfile を作成**

```
:80 {
	handle /api/* {
		reverse_proxy api:3001
	}
	handle /i/* {
		reverse_proxy api:3001
	}
	handle {
		root * /srv/web
		try_files {path} /index.html
		file_server
	}
}
```

- [ ] **Step 2: api の Dockerfile を作成**

`packages/api/Dockerfile`（build context は repo root）:

```dockerfile
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/api packages/api
RUN pnpm --filter @picsur/api build

FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=build /app/packages/api/dist ./dist
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

- [ ] **Step 3: docker-compose.yml を作成**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: picsur
      POSTGRES_USER: picsur
      POSTGRES_PASSWORD: picsur
    volumes:
      - db-data:/var/lib/postgresql/data

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    environment:
      PORT: 3001
      PICSUR_JWT_SECRET: ${PICSUR_JWT_SECRET}
      PICSUR_DB_HOST: postgres
      PICSUR_DB_USER: picsur
      PICSUR_DB_PASSWORD: picsur
      PICSUR_DB_DATABASE: picsur
    depends_on:
      - postgres

  caddy:
    image: caddy:2-alpine
    ports:
      - "8080:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./packages/web/dist/client:/srv/web
    depends_on:
      - api

volumes:
  db-data:
```

- [ ] **Step 4: compose のビルド＆疎通を確認**

Run: `PICSUR_JWT_SECRET=dev pnpm --filter @picsur/web build && PICSUR_JWT_SECRET=dev docker compose up -d --build`
Expected: 3 サービス（postgres / api / caddy）が起動。

Run: `curl -s localhost:8080/api/health`
Expected: `{"ok":true}`（Caddy → api 経由）

Run: `curl -s localhost:8080/`
Expected: web の `index.html`（`Picsur` を含む HTML）

Run: `docker compose down`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add Caddy reverse proxy, docker-compose, api Dockerfile"
```

---

## Task 7: CLAUDE.md 更新 + 最終確認

**Files:**
- Modify: `CLAUDE.md`
- Create: `README` セクション追記は不要（既存 README はプロダクト説明として温存）

- [ ] **Step 1: CLAUDE.md の冒頭に書き直し中である旨を追記**

`CLAUDE.md` の `# CLAUDE.md` ヘッダ直後（最初の段落の前）に以下を挿入:

```markdown
> **⚠️ 全面書き直し進行中（2026-06）。** このリポジトリは Hono + Drizzle + Vike の新スタックへ移行中。
> 旧 NestJS/Angular 実装は `archive/` に退避済み（参照専用）。新コードは `packages/{shared,api,web}` の pnpm workspace。
> 設計は `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md`、足場計画は `docs/superpowers/plans/2026-06-03-picsur-foundation.md` を参照。
> 以下の旧アーキテクチャ記述は `archive/` のコードについての説明。
```

- [ ] **Step 2: 全パッケージの test / build / typecheck が緑か確認**

Run: `pnpm install && pnpm -r test && pnpm -r build && pnpm -r typecheck`
Expected: shared（1 test PASS）/ api（1 test PASS）/ web（no tests, PASS）が全部成功。build も 3 パッケージ成功。typecheck もエラー無し。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: mark CLAUDE.md as rewrite-in-progress"
```

---

## 完了条件

- `archive/` に旧コードが退避され、yarn 系ファイルが消えている
- `pnpm install` / `pnpm -r test` / `pnpm -r build` / `pnpm -r typecheck` が全部緑
- `docker compose up` で caddy(:8080) → api `/api/health` と web トップが疎通
- 後続: Plan 2（shared: Drizzle schema + 移行 migration + drizzle-zod DTO）へ
