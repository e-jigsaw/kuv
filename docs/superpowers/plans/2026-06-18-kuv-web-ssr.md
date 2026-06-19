# kuv web SSR 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** kuv の web を静的 SPA（`ssr:false` + prerender）から vike SSR（Node プロセス）に変え、動的ルート `/image/@id` の誤 hydrate を構造的に解消する。

**Architecture:** web を Hono + `@hono/node-server` の Node プロセス（port 3000）にして `vike/server` の `renderPage` で SSR する。各保護ページの `+data.ts`（サーバ実行）が cookie を API に転送して初期データを取得、401 は `vike/abort` の `redirect("/login")`。Caddy は静的配信をやめ `web:3000` へ `reverse_proxy`。コンポーネントは `useData()` 由来の初期データを props で受ける形にリファクタする。

**Tech Stack:** vike 0.4 / vike-react / React 19 / Hono / @hono/node-server / Node 24（TS をネイティブ型ストリップで実行）/ pnpm workspace / Drizzle + Hono（api）/ Caddy / docker-compose。

---

## スコープ注記（spec からの逸脱・確定事項）

- spec（`2026-06-18-kuv-web-ssr-design.md`）は「api / shared 非対象」としていたが、**`image/@id` の初期データ取得のため `GET /api/image/:id`（所有者一致・個別メタ）を api に新設する**ことをユーザが決定した（2026-06-18）。本プランはこの api 変更を含む。shared は触らない。
- ランタイムは **Node 維持**（Bun 化しない）。SSR サーバは `node server/index.ts` を直接実行する（Node 24 の TS 型ストリップ。tsup/tsx を新規導入しない。server/index.ts は型ストリップ互換＝enum / namespace / 値としての型を含まない）。
- ミューテーション（アップロード / 設定更新 / apikey / パスワード変更）は従来どおりクライアント `lib/api.ts` 経由のまま。サーバアクション化しない。

## File Structure

**api（@kuv/api）— 新設の個別メタ取得:**
- Modify `packages/api/src/db/image-queries.ts` — 所有者一致の単一画像取得 `findImageForUser` を追加。
- Modify `packages/api/src/routes/image.ts` — `GET /:id`（要認証・所有者一致）を `/list` の後に追加。
- Modify `packages/api/src/routes/image.test.ts` — `GET /:id` の 401 / 取得 / 404 を追加。

**web（@kuv/web）— SSR 化本体:**
- Modify `packages/web/lib/api.ts` — SSR/client で baseUrl 解決、`apiGet` に cookie 引数を追加（他シグネチャ不変）。
- Modify `packages/web/lib/api.test.ts` — SSR 分岐（絶対 URL + cookie 転送）のテスト追加。
- Modify `packages/web/pages/+config.ts` — `ssr: true`、`prerender` 削除。
- Delete `packages/web/pages/+guard.ts` — 認証は各 `+data` が兼任。
- Create `packages/web/pages/index/+data.ts`（+ `+data.test.ts`） — 一覧取得 + 401 redirect。
- Create `packages/web/pages/image/@id/+data.ts`（+ `+data.test.ts`） — 個別メタ取得 + 401 redirect。
- Create `packages/web/pages/settings/+data.ts`（+ `+data.test.ts`） — 設定 + apikey 取得 + 401 redirect。
- Modify `packages/web/pages/index/+Page.tsx` / `image/@id/+Page.tsx` / `settings/+Page.tsx` — `useData()` で受けて props で子へ。
- Modify `packages/web/components/{HomePage,ImageView,KeepOriginalToggle,ApikeyManager}.tsx`（+ 各 `.test.tsx`） — 初期データを props で受け、初期 fetch の `useEffect` を撤去。
- Create `packages/web/server/index.ts` — Hono + @hono/node-server の SSR サーバ。
- Modify `packages/web/package.json` — `hono` / `@hono/node-server` を deps に、`@types/node` を devDeps に、`start` script 追加。
- Modify `packages/web/tsconfig.json` — `types` に `node`、`include` に `server`。

**deploy:**
- Modify `packages/web/Dockerfile` — caddy 焼き込み廃止 → node:24-alpine build→runtime（api Dockerfile と同パターン）。
- Modify `docker-compose.yml` — `web` サービス追加、`caddy` を `caddy:2-alpine` イメージに。
- Modify `Caddyfile` — 静的 handle を `reverse_proxy web:3000` に。
- Modify `deploy/MIGRATION.md` — §3 スモークの期待値を SSR HTML に、web サービス追加を反映。

**後始末:**
- `hack` ブランチ削除（local + origin）、`docs/superpowers/HANDOFF-2026-06-18-web-ssr.md` 削除。

---

## Task 0: spec とプランを commit

ブランチ `feat/web-ssr`（`562898d` 基点）上で作業。最初に spec と本プランを記録する。

- [ ] **Step 1: spec とプランを add して commit**

```bash
cd /Users/jigsaw/dev/github.com/e-jigsaw/Picsur
git add docs/superpowers/specs/2026-06-18-kuv-web-ssr-design.md docs/superpowers/plans/2026-06-18-kuv-web-ssr.md
git commit -m "docs(web): SSR 化の spec と実装プランを追加"
```

（`HANDOFF-2026-06-18-web-ssr.md` は commit しない。最後に削除する。）

---

## Task 1: api に個別画像メタ取得 `GET /api/image/:id` を追加

**Files:**
- Modify: `packages/api/src/db/image-queries.ts`
- Modify: `packages/api/src/routes/image.ts`
- Test: `packages/api/src/routes/image.test.ts`

> api テストは testcontainers を使うため docker が必要（`pnpm -F @kuv/api test` 実行時に postgres コンテナが起動する）。

- [ ] **Step 1: 失敗するテストを追加**

`packages/api/src/routes/image.test.ts` の末尾（`upload stores original ...` テストの後）に以下を追記:

```ts
test("get one without auth returns 401", async () => {
  const res = await app.request("/api/image/whatever");
  expect(res.status).toBe(401);
});

test("get one returns meta for an own image", async () => {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 7, g: 8, b: 9 } },
  })
    .png()
    .toBuffer();
  const up = await app.request("/api/image", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(buf, "meta.png", "image/png"),
  });
  const { id } = (await up.json()) as { id: string };

  const res = await app.request(`/api/image/${id}`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    id: string;
    file_name: string;
    created: string;
    master_filetype: string;
    links: { view: string; direct: string };
  };
  expect(json.id).toBe(id);
  expect(json.file_name).toBe("meta.png");
  expect(json.master_filetype).toBe("image/png");
  expect(json.links.direct).toBe(`/i/${id}.png`);
  expect(typeof json.created).toBe("string");
});

test("get one returns 404 for an unknown id", async () => {
  const res = await app.request("/api/image/does-not-exist", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm -F @kuv/api test -- image`
Expected: 新規 3 テストのうち「get one returns meta ...」が 404 で FAIL（ルート未実装。`GET /:id` が無いので Hono のデフォルト 404）。`get one returns 404 ...` は偶然 pass しうるが、meta 取得が落ちることを確認する。

- [ ] **Step 3: クエリ層に `findImageForUser` を追加**

`packages/api/src/db/image-queries.ts` の `listImages`（`ImageListEntry` 定義の近く）の後に追加:

```ts
// 個別画像メタ（所有者一致）。SSR の +data 用に1件取得。
export async function findImageForUser(
  db: Db,
  id: string,
  userId: string,
): Promise<ImageListEntry | null> {
  const [row] = await db
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
    .where(and(eq(image.id, id), eq(image.userId, userId)))
    .limit(1);
  return row ?? null;
}
```

（`image` / `imageFile` / `and` / `eq` / `Db` / `ImageListEntry` は同ファイルで既に import / 定義済み。）

- [ ] **Step 4: ルートを追加**

`packages/api/src/routes/image.ts` の import に `findImageForUser` を足す:

```ts
import {
  deleteImage,
  findImageById,
  findImageForUser,
  getSettings,
  insertImage,
  listImages,
} from "../db/image-queries";
```

`imageRoutes.get("/list", ...)` ブロックの直後（`imageRoutes.post("/", ...)` の前）に追加:

```ts
// 個別画像メタ（要認証・所有者一致）。SSR の +data 用。
// 注: GET "/list" より後に登録すること（"/list" を ":id" にマッチさせないため）
imageRoutes.get("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const row = await findImageForUser(c.var.db, id, c.var.user!.id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    id: row.id,
    file_name: row.fileName,
    created: row.created,
    master_filetype: row.masterFiletype,
    links: links(row.id, row.masterFiletype),
  });
});
```

- [ ] **Step 5: テストを実行して pass を確認**

Run: `pnpm -F @kuv/api test -- image`
Expected: PASS（既存 + 新規 3 テストすべて）。

- [ ] **Step 6: api 全体の typecheck**

Run: `pnpm -F @kuv/api typecheck`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/db/image-queries.ts packages/api/src/routes/image.ts packages/api/src/routes/image.test.ts
git commit -m "feat(api): 所有者一致の個別画像メタ GET /api/image/:id を追加"
```

---

## Task 2: web `lib/api.ts` に baseUrl 解決と cookie 転送を追加

**Files:**
- Modify: `packages/web/lib/api.ts`
- Modify: `packages/web/tsconfig.json`
- Modify: `packages/web/package.json`（@types/node を devDeps へ）
- Test: `packages/web/lib/api.test.ts`

クライアント実行時は baseUrl が空文字なので既存の呼び出し・既存テストは挙動不変。SSR 実行時のみ絶対 URL に解決し、`apiGet(path, cookie)` で cookie ヘッダを付与する。

- [ ] **Step 1: @types/node を web に追加**

`packages/web/package.json` の `devDependencies` に追加（アルファベット順で `@vitejs/plugin-react` の前あたり）:

```json
    "@types/node": "^24.0.0",
```

Run: `pnpm install`
Expected: lockfile 更新、エラーなし。

- [ ] **Step 2: tsconfig に node 型を追加**

`packages/web/tsconfig.json` を編集（`process` を型解決できるように）:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"]
  },
  "include": ["pages", "server", "vite.config.ts"]
}
```

（`server` は Task 6 で作るが、先に include に入れておいて問題ない。存在しない間も tsc はエラーにしない。）

- [ ] **Step 3: 失敗するテストを追加**

`packages/web/lib/api.test.ts` の末尾に追加:

```ts
test("SSR resolves an absolute base and forwards the cookie", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubEnv("KUV_API_BASE", "http://api:3001");
  fetchMock.mockResolvedValue(jsonResponse({ images: [] }));

  await apiGet("/api/image/list", "kuv_jwt=abc");

  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("http://api:3001/api/image/list");
  expect(new Headers(init.headers).get("cookie")).toBe("kuv_jwt=abc");

  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("SSR falls back to http://api:3001 when KUV_API_BASE is unset", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubEnv("KUV_API_BASE", "");
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

  await apiGet("/api/settings");

  expect(fetchMock.mock.calls[0]![0]).toBe("http://api:3001/api/settings");

  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
```

> `vi.stubGlobal("window", undefined)` で `typeof window === "undefined"` が true になる。`vi.stubEnv("KUV_API_BASE", "")` は空文字なので `??` ではなく実装側で空文字を falsy 扱いするため、実装は `process.env.KUV_API_BASE || "http://api:3001"`（`??` でなく `||`）にすること（空文字フォールバックを効かせる）。

- [ ] **Step 4: テストを実行して失敗を確認**

Run: `pnpm -F @kuv/web test -- api`
Expected: 新規 2 テストが FAIL（現状 `apiGet` は cookie を受けず baseUrl も付けない）。既存 7 テストは PASS のまま。

- [ ] **Step 5: 実装**

`packages/web/lib/api.ts` の `request` と `apiGet` を差し替える。`UnauthorizedError` クラス定義はそのまま残す。`request` の前に baseUrl 解決と cookie 付与のヘルパを足す:

```ts
// SSR（window 無し）では api コンテナへ絶対 URL、client では相対（Caddy 経由）。
function resolveBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.KUV_API_BASE || "http://api:3001";
}

function withCookie(init: RequestInit | undefined, cookie: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  return { ...init, headers };
}

async function request<T>(
  path: string,
  init?: RequestInit,
  cookie?: string,
): Promise<T> {
  const finalInit = cookie ? withCookie(init, cookie) : init;
  const res = await fetch(resolveBase() + path, finalInit);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, cookie?: string): Promise<T> {
  return request<T>(path, undefined, cookie);
}
```

`apiPost` / `apiPut` / `apiDelete` / `uploadImage` は **変更しない**（`request(path, init)` を呼ぶ既存実装のまま。client では `resolveBase()` が "" を返すので挙動不変）。

- [ ] **Step 6: テストを実行して pass を確認**

Run: `pnpm -F @kuv/web test -- api`
Expected: PASS（既存 7 + 新規 2 = 9）。client 側の既存アサーション（`toHaveBeenCalledWith("/api/health", undefined)` 等）も baseUrl が "" のため不変で pass する。

- [ ] **Step 7: typecheck**

Run: `pnpm -F @kuv/web typecheck`
Expected: エラーなし。

- [ ] **Step 8: Commit**

```bash
git add packages/web/lib/api.ts packages/web/lib/api.test.ts packages/web/tsconfig.json packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): lib/api に SSR baseUrl 解決と cookie 転送を追加"
```

---

## Task 3: `+config.ts` を SSR に、`+guard.ts` を削除

**Files:**
- Modify: `packages/web/pages/+config.ts`
- Delete: `packages/web/pages/+guard.ts`

prerender を消すことで、後続の `+data` が build 時に実行されなくなる（リクエスト時 SSR のみ）。認証は各 `+data` が兼任するので client guard は廃止する。

- [ ] **Step 1: +config.ts を SSR 化**

`packages/web/pages/+config.ts` を全置換:

```ts
import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  extends: vikeReact,
  ssr: true,
  title: "kuv",
} satisfies Config;
```

- [ ] **Step 2: +guard.ts を削除**

```bash
git rm packages/web/pages/+guard.ts
```

- [ ] **Step 3: ビルドが通ることを確認**

Run: `pnpm -F @kuv/web build`
Expected: SUCCESS。prerender 設定が無いので build 時に `+data` / API 呼び出しは走らない。`dist/client` と `dist/server` が生成される。

- [ ] **Step 4: 既存テストが緑のままか確認**

Run: `pnpm -F @kuv/web test`
Expected: 既存テストすべて PASS（コンポーネントはまだ未改修＝この時点では useEffect で client fetch のまま動く）。

- [ ] **Step 5: Commit**

```bash
git add packages/web/pages/+config.ts
git commit -m "feat(web): vike を SSR (ssr:true) に切替え、client guard を廃止"
```

---

## Task 4: 各保護ページに `+data.ts` を追加（cookie 転送 + 401 redirect）

**Files:**
- Create: `packages/web/pages/index/+data.ts`, `packages/web/pages/index/+data.test.ts`
- Create: `packages/web/pages/image/@id/+data.ts`, `packages/web/pages/image/@id/+data.test.ts`
- Create: `packages/web/pages/settings/+data.ts`, `packages/web/pages/settings/+data.test.ts`

`+data` はサーバ実行（vike 既定で data hook は server 環境）。`pageContext.headers?.["cookie"]` を `apiGet` に渡す。401（`UnauthorizedError`）は `redirect("/login")` を throw、それ以外の API エラーはそのまま throw（vike のエラーページに委ねる）。

### 4a: index/+data.ts（画像一覧）

- [ ] **Step 1: 失敗するテストを作成**

Create `packages/web/pages/index/+data.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, apiGet: vi.fn() };
});

import { apiGet, UnauthorizedError } from "../../lib/api";
import { data } from "./+data";

const apiGetMock = vi.mocked(apiGet);

beforeEach(() => apiGetMock.mockReset());

test("returns images and forwards the cookie", async () => {
  apiGetMock.mockResolvedValue({ images: [{ id: "x" }] } as never);
  const ctx = { headers: { cookie: "kuv_jwt=abc" } } as never;

  const result = await data(ctx);

  expect(result.images).toHaveLength(1);
  expect(apiGetMock).toHaveBeenCalledWith("/api/image/list", "kuv_jwt=abc");
});

test("redirects to /login on Unauthorized", async () => {
  apiGetMock.mockRejectedValue(new UnauthorizedError());
  const ctx = { headers: {} } as never;

  await expect(data(ctx)).rejects.not.toBeInstanceOf(UnauthorizedError);
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `pnpm -F @kuv/web test -- index/+data`
Expected: FAIL（`./+data` が存在しない → import エラー）。

- [ ] **Step 3: +data.ts を実装**

Create `packages/web/pages/index/+data.ts`:

```ts
import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { apiGet, UnauthorizedError } from "../../lib/api";
import type { ImageEntry } from "../../lib/api";

export type Data = { images: ImageEntry[] };

export async function data(pageContext: PageContextServer): Promise<Data> {
  const cookie = pageContext.headers?.["cookie"] ?? undefined;
  try {
    const { images } = await apiGet<{ images: ImageEntry[] }>(
      "/api/image/list",
      cookie,
    );
    return { images };
  } catch (e) {
    if (e instanceof UnauthorizedError) throw redirect("/login");
    throw e;
  }
}
```

- [ ] **Step 4: 実行して pass を確認**

Run: `pnpm -F @kuv/web test -- index/+data`
Expected: PASS（2 テスト）。

### 4b: image/@id/+data.ts（個別メタ）

- [ ] **Step 5: 失敗するテストを作成**

Create `packages/web/pages/image/@id/+data.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../../lib/api")>();
  return { ...actual, apiGet: vi.fn() };
});

import { apiGet, UnauthorizedError } from "../../../lib/api";
import { data } from "./+data";

const apiGetMock = vi.mocked(apiGet);

beforeEach(() => apiGetMock.mockReset());

test("returns the image meta for the route id with the cookie", async () => {
  apiGetMock.mockResolvedValue({ id: "img1", file_name: "cat.png" } as never);
  const ctx = {
    headers: { cookie: "kuv_jwt=abc" },
    routeParams: { id: "img1" },
  } as never;

  const result = await data(ctx);

  expect(result.image.id).toBe("img1");
  expect(apiGetMock).toHaveBeenCalledWith("/api/image/img1", "kuv_jwt=abc");
});

test("redirects to /login on Unauthorized", async () => {
  apiGetMock.mockRejectedValue(new UnauthorizedError());
  const ctx = { headers: {}, routeParams: { id: "img1" } } as never;

  await expect(data(ctx)).rejects.not.toBeInstanceOf(UnauthorizedError);
});
```

- [ ] **Step 6: 実行して失敗を確認**

Run: `pnpm -F @kuv/web test -- "image/@id/+data"`
Expected: FAIL（`./+data` が無い）。

- [ ] **Step 7: +data.ts を実装**

Create `packages/web/pages/image/@id/+data.ts`:

```ts
import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { apiGet, UnauthorizedError } from "../../../lib/api";
import type { ImageEntry } from "../../../lib/api";

export type Data = { image: ImageEntry };

export async function data(pageContext: PageContextServer): Promise<Data> {
  const cookie = pageContext.headers?.["cookie"] ?? undefined;
  const id = pageContext.routeParams!.id!;
  try {
    const image = await apiGet<ImageEntry>(`/api/image/${id}`, cookie);
    return { image };
  } catch (e) {
    if (e instanceof UnauthorizedError) throw redirect("/login");
    throw e; // 404 等はそのまま vike のエラーページへ
  }
}
```

- [ ] **Step 8: 実行して pass を確認**

Run: `pnpm -F @kuv/web test -- "image/@id/+data"`
Expected: PASS（2 テスト）。

### 4c: settings/+data.ts（設定 + apikey）

- [ ] **Step 9: 失敗するテストを作成**

Create `packages/web/pages/settings/+data.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, apiGet: vi.fn() };
});

import { apiGet, UnauthorizedError } from "../../lib/api";
import { data } from "./+data";

const apiGetMock = vi.mocked(apiGet);

beforeEach(() => apiGetMock.mockReset());

test("returns settings and apikeys with the cookie", async () => {
  apiGetMock
    .mockResolvedValueOnce({ keep_original: true } as never)
    .mockResolvedValueOnce({ apikeys: [{ id: "k1" }] } as never);
  const ctx = { headers: { cookie: "kuv_jwt=abc" } } as never;

  const result = await data(ctx);

  expect(result.settings.keep_original).toBe(true);
  expect(result.apikeys).toHaveLength(1);
  expect(apiGetMock).toHaveBeenCalledWith("/api/settings", "kuv_jwt=abc");
  expect(apiGetMock).toHaveBeenCalledWith("/api/apikey", "kuv_jwt=abc");
});

test("redirects to /login on Unauthorized", async () => {
  apiGetMock.mockRejectedValue(new UnauthorizedError());
  const ctx = { headers: {} } as never;

  await expect(data(ctx)).rejects.not.toBeInstanceOf(UnauthorizedError);
});
```

- [ ] **Step 10: 実行して失敗を確認**

Run: `pnpm -F @kuv/web test -- settings/+data`
Expected: FAIL（`./+data` が無い）。

- [ ] **Step 11: +data.ts を実装**

Create `packages/web/pages/settings/+data.ts`:

```ts
import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { apiGet, UnauthorizedError } from "../../lib/api";
import type { ApikeyEntry, Settings } from "../../lib/api";

export type Data = { settings: Settings; apikeys: ApikeyEntry[] };

export async function data(pageContext: PageContextServer): Promise<Data> {
  const cookie = pageContext.headers?.["cookie"] ?? undefined;
  try {
    const [settings, apikeyRes] = await Promise.all([
      apiGet<Settings>("/api/settings", cookie),
      apiGet<{ apikeys: ApikeyEntry[] }>("/api/apikey", cookie),
    ]);
    return { settings, apikeys: apikeyRes.apikeys };
  } catch (e) {
    if (e instanceof UnauthorizedError) throw redirect("/login");
    throw e;
  }
}
```

- [ ] **Step 12: 実行して pass を確認**

Run: `pnpm -F @kuv/web test -- settings/+data`
Expected: PASS（2 テスト）。

- [ ] **Step 13: typecheck + commit**

Run: `pnpm -F @kuv/web typecheck`
Expected: エラーなし。

```bash
git add packages/web/pages/index/+data.ts packages/web/pages/index/+data.test.ts \
  "packages/web/pages/image/@id/+data.ts" "packages/web/pages/image/@id/+data.test.ts" \
  packages/web/pages/settings/+data.ts packages/web/pages/settings/+data.test.ts
git commit -m "feat(web): 各保護ページに +data を追加（cookie 転送・401 redirect）"
```

---

## Task 5: コンポーネントを props 起点にリファクタ + ページで `useData()` 配線

**Files:**
- Modify: `components/HomePage.tsx` / `HomePage.test.tsx`, `pages/index/+Page.tsx`
- Modify: `components/ImageView.tsx` / `ImageView.test.tsx`, `pages/image/@id/+Page.tsx`
- Modify: `components/KeepOriginalToggle.tsx` / `KeepOriginalToggle.test.tsx`, `components/ApikeyManager.tsx` / `ApikeyManager.test.tsx`, `pages/settings/+Page.tsx`

初期表示データを `useData()` → props 経由に変える。ミューテーション（アップロード / 削除 / トグル / 発行 / 失効）は従来どおり `lib/api` を呼ぶ。各コンポーネントと対応する `+Page.tsx`・テストは同じ step 内で更新し、各 commit でテストを緑に保つ。

### 5a: HomePage

- [ ] **Step 1: テストを更新**

`packages/web/components/HomePage.test.tsx` の 2 テストを差し替える（`listResponse` 定義はそのまま残す）:

```ts
test("renders the provided initial images", () => {
  render(<HomePage initialImages={listResponse.images} />);
  const img = screen.getByAltText("cat.png") as HTMLImageElement;
  expect(img.src).toContain("/i/img1");
});

test("uploads a selected file and refreshes the list", async () => {
  // 1回目: アップロード / 2回目: 再取得一覧
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "img1",
          file_name: "cat.png",
          links: { view: "/i/img1", direct: "/i/img1.png" },
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(listResponse), { status: 200 }),
    );

  render(<HomePage initialImages={[]} />);

  const file = new File([new Uint8Array([1])], "cat.png", { type: "image/png" });
  const input = screen.getByLabelText("Upload") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  // 1回目の呼び出しが multipart アップロード、2回目が一覧再取得
  const [uploadPath, uploadInit] = fetchMock.mock.calls[0]!;
  expect(uploadPath).toBe("/api/image");
  expect(uploadInit.body).toBeInstanceOf(FormData);
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/image/list");
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `pnpm -F @kuv/web test -- HomePage`
Expected: FAIL（`HomePage` がまだ `initialImages` prop を受けない）。

- [ ] **Step 3: HomePage を実装**

`packages/web/components/HomePage.tsx` を差し替え（初期 fetch の `useEffect` を撤去、`reload` はアップロード後用に残す）:

```tsx
import { useCallback, useState } from "react";
import { apiGet, uploadImage } from "../lib/api";
import type { ImageEntry } from "../lib/api";

export function HomePage({ initialImages }: { initialImages: ImageEntry[] }) {
  const [images, setImages] = useState<ImageEntry[]>(initialImages);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { images } = await apiGet<{ images: ImageEntry[] }>(
        "/api/image/list",
      );
      setImages(images);
    } catch {
      setError("failed to load images");
    }
  }, []);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadImage(file);
      await reload();
    } catch {
      setError("upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <main className="p-6">
      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500">
          Upload
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={onUpload}
            disabled={busy}
            className="hidden"
            aria-label="Upload"
          />
        </label>
        {busy && <span className="text-sm text-neutral-400">uploading…</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {images.map((im) => (
          <a
            key={im.id}
            href={`/image/${im.id}`}
            className="group overflow-hidden rounded border border-neutral-800"
          >
            <img
              src={im.links.view}
              alt={im.file_name}
              loading="lazy"
              className="aspect-square w-full object-cover transition group-hover:opacity-80"
            />
            <p className="truncate px-2 py-1 text-xs text-neutral-400">
              {im.file_name}
            </p>
          </a>
        ))}
      </div>
      {images.length === 0 && !error && (
        <p className="text-sm text-neutral-500">No images yet.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: index/+Page.tsx を配線**

`packages/web/pages/index/+Page.tsx` を差し替え:

```tsx
import { useData } from "vike-react/useData";
import { HomePage } from "../../components/HomePage";
import type { Data } from "./+data";

export default function Page() {
  const { images } = useData<Data>();
  return <HomePage initialImages={images} />;
}
```

- [ ] **Step 5: 実行して pass を確認**

Run: `pnpm -F @kuv/web test -- HomePage`
Expected: PASS（2 テスト）。

### 5b: ImageView

- [ ] **Step 6: テストを更新**

`packages/web/components/ImageView.test.tsx` を差し替え（`listResponse` を単一 `image` に変更、「not found」テストは削除＝個別メタ 404 は +data/エラーページの責務）:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ImageView } from "./ImageView";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const image = {
  id: "img1",
  file_name: "cat.png",
  created: "2026-06-05T00:00:00Z",
  master_filetype: "image/png",
  links: { view: "/i/img1", direct: "/i/img1.png" },
};

test("renders image, metadata and direct link", () => {
  render(<ImageView image={image} onDeleted={vi.fn()} />);
  expect(screen.getByAltText("cat.png")).toBeDefined();
  expect(screen.getByText("cat.png")).toBeDefined();
  expect(screen.getByText("/i/img1.png")).toBeDefined();
});

test("deletes after confirmation and calls onDeleted", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  const onDeleted = vi.fn();
  render(<ImageView image={image} onDeleted={onDeleted} />);

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/image/img1");
  expect(init.method).toBe("DELETE");
});
```

- [ ] **Step 7: 実行して失敗を確認**

Run: `pnpm -F @kuv/web test -- ImageView`
Expected: FAIL（`ImageView` がまだ `image` prop を受けず `id` を取る）。

- [ ] **Step 8: ImageView を実装**

`packages/web/components/ImageView.tsx` を差し替え（初期 fetch の `useEffect` / `loaded` / not-found 分岐を撤去）:

```tsx
import { useState } from "react";
import { apiDelete } from "../lib/api";
import type { ImageEntry } from "../lib/api";

export function ImageView({
  image,
  onDeleted,
}: {
  image: ImageEntry;
  onDeleted: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCopy = async () => {
    await navigator.clipboard.writeText(
      new URL(image.links.direct, window.location.origin).href,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onDelete = async () => {
    if (!confirm(`Delete ${image.file_name}?`)) return;
    try {
      await apiDelete(`/api/image/${image.id}`);
      onDeleted();
    } catch {
      setError("delete failed");
    }
  };

  return (
    <main className="flex flex-col items-center gap-4 p-6">
      <img
        src={image.links.view}
        alt={image.file_name}
        className="max-h-[70vh] max-w-full rounded border border-neutral-800"
      />
      <div className="flex flex-col items-center gap-2 text-sm">
        <p className="font-medium">{image.file_name}</p>
        <p className="text-neutral-500">
          {new Date(image.created).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-neutral-700 px-3 py-1 font-mono text-xs text-neutral-300 hover:bg-neutral-900"
          title="Copy direct link"
        >
          {copied ? "copied!" : image.links.direct}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded bg-red-700 px-4 py-1.5 text-sm font-medium hover:bg-red-600"
        >
          Delete
        </button>
        {error && <p className="text-red-400">{error}</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 9: image/@id/+Page.tsx を配線**

`packages/web/pages/image/@id/+Page.tsx` を差し替え:

```tsx
import { navigate } from "vike/client/router";
import { useData } from "vike-react/useData";
import { ImageView } from "../../../components/ImageView";
import type { Data } from "./+data";

export default function Page() {
  const { image } = useData<Data>();
  return <ImageView image={image} onDeleted={() => navigate("/")} />;
}
```

- [ ] **Step 10: 実行して pass を確認**

Run: `pnpm -F @kuv/web test -- ImageView`
Expected: PASS（2 テスト）。

### 5c: settings 系（KeepOriginalToggle + ApikeyManager）

- [ ] **Step 11: KeepOriginalToggle テストを更新**

`packages/web/components/KeepOriginalToggle.test.tsx` のテストを差し替え:

```tsx
test("renders the provided setting and toggles it", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ keep_original: true }), { status: 200 }),
  );
  render(<KeepOriginalToggle initialKeepOriginal={false} />);

  const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
  expect(checkbox.checked).toBe(false);

  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox.checked).toBe(true));

  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/settings");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ keep_original: true });
});
```

- [ ] **Step 12: ApikeyManager テストを更新**

`packages/web/components/ApikeyManager.test.tsx` の 2 テストを差し替え（`key1` 定義はそのまま）:

```tsx
test("lists keys and issues a new one", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ apikey: { ...key1, id: "k2", name: "new" } }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ apikeys: [{ ...key1, id: "k2", name: "new" }, key1] }),
        { status: 200 },
      ),
    );
  render(<ApikeyManager initialKeys={[key1]} />);

  expect(screen.getByText("sharex")).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "New key" }));
  await waitFor(() => expect(screen.getByText("new")).toBeDefined());
  expect(fetchMock.mock.calls[0]![0]).toBe("/api/apikey");
  expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
});

test("revokes a key after confirmation", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ apikeys: [] }), { status: 200 }),
    );
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  render(<ApikeyManager initialKeys={[key1]} />);

  expect(screen.getByText("sharex")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

  await waitFor(() => expect(screen.queryByText("sharex")).toBeNull());
  expect(fetchMock.mock.calls[0]![0]).toBe("/api/apikey/k1");
  expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
});
```

- [ ] **Step 13: 実行して失敗を確認**

Run: `pnpm -F @kuv/web test -- KeepOriginalToggle ApikeyManager`
Expected: FAIL（両コンポーネントがまだ初期 prop を受けない）。

- [ ] **Step 14: KeepOriginalToggle を実装**

`packages/web/components/KeepOriginalToggle.tsx` を差し替え（初期 fetch の `useEffect` と loading 分岐を撤去）:

```tsx
import { useState } from "react";
import { apiPut } from "../lib/api";
import type { Settings } from "../lib/api";

export function KeepOriginalToggle({
  initialKeepOriginal,
}: {
  initialKeepOriginal: boolean;
}) {
  const [keepOriginal, setKeepOriginal] = useState(initialKeepOriginal);
  const [error, setError] = useState<string | null>(null);

  const onToggle = async (next: boolean) => {
    setError(null);
    try {
      const s = await apiPut<Settings>("/api/settings", {
        keep_original: next,
      });
      setKeepOriginal(s.keep_original);
    } catch {
      setError("failed to save settings");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={keepOriginal}
          onChange={(e) => onToggle(e.target.checked)}
          className="size-4"
        />
        Keep original files on upload
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 15: ApikeyManager を実装**

`packages/web/components/ApikeyManager.tsx` の冒頭の import と関数シグネチャ・初期 state を差し替え（`reload` 以降の本体・JSX はそのまま残す。`useEffect` による初期 reload を削除）:

```tsx
import { useCallback, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import type { ApikeyEntry } from "../lib/api";

export function ApikeyManager({
  initialKeys,
}: {
  initialKeys: ApikeyEntry[];
}) {
  const [keys, setKeys] = useState<ApikeyEntry[]>(initialKeys);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { apikeys } = await apiGet<{ apikeys: ApikeyEntry[] }>(
        "/api/apikey",
      );
      setKeys(apikeys);
    } catch {
      setError("failed to load api keys");
    }
  }, []);
```

（この直後にある旧 `useEffect(() => { void reload(); }, [reload]);` の 1 ブロックを削除する。`onIssue` / `onRevoke` / `onCopy` と `return (...)` の JSX は変更しない。）

- [ ] **Step 16: settings/+Page.tsx を配線**

`packages/web/pages/settings/+Page.tsx` を差し替え:

```tsx
import { useData } from "vike-react/useData";
import { ApikeyManager } from "../../components/ApikeyManager";
import { KeepOriginalToggle } from "../../components/KeepOriginalToggle";
import { PasswordForm } from "../../components/PasswordForm";
import type { Data } from "./+data";

export default function Page() {
  const { settings, apikeys } = useData<Data>();
  return (
    <main className="flex flex-col gap-10 p-6">
      <section>
        <h2 className="mb-3 text-lg font-bold">Upload</h2>
        <KeepOriginalToggle initialKeepOriginal={settings.keep_original} />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">API keys</h2>
        <ApikeyManager initialKeys={apikeys} />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">Password</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
```

- [ ] **Step 17: 実行して pass を確認**

Run: `pnpm -F @kuv/web test -- KeepOriginalToggle ApikeyManager`
Expected: PASS（各 1 / 2 テスト）。

- [ ] **Step 18: web 全テスト + typecheck + build**

Run: `pnpm -F @kuv/web test`
Expected: 全 PASS（合計テスト数 = 既存 19 − ImageView の not-found 1 + lib/api SSR 2 + +data 6 = 26 程度。数より「赤が無い」ことを確認）。

Run: `pnpm -F @kuv/web typecheck`
Expected: エラーなし。

Run: `pnpm -F @kuv/web build`
Expected: SUCCESS。

- [ ] **Step 19: Commit**

```bash
git add packages/web/components packages/web/pages/index/+Page.tsx \
  "packages/web/pages/image/@id/+Page.tsx" packages/web/pages/settings/+Page.tsx
git commit -m "refactor(web): コンポーネントを useData 由来の props 起点に変更"
```

---

## Task 6: SSR サーバ `server/index.ts` を追加

**Files:**
- Create: `packages/web/server/index.ts`
- Modify: `packages/web/package.json`（deps に `hono` / `@hono/node-server`、`start` script）

Hono + @hono/node-server で SSR サーバを書く。`/assets/*` と `/favicon.ico` は `dist/client` から静的配信、それ以外は `renderPage` に流す。本番は `node server/index.ts`（Node 24 の TS 型ストリップ実行）。dev は従来どおり `vite`（vike の dev SSR middleware）なので、このサーバは本番専用。

- [ ] **Step 1: 依存を追加**

`packages/web/package.json` の `dependencies` に追加:

```json
    "@hono/node-server": "^1.13.0",
    "hono": "^4.6.0",
```

`scripts` に追加:

```json
    "start": "node server/index.ts",
```

Run: `pnpm install`
Expected: lockfile 更新、エラーなし。

- [ ] **Step 2: server/index.ts を実装**

Create `packages/web/server/index.ts`:

```ts
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { renderPage } from "vike/server";

const app = new Hono();

// vike が出力する静的アセット。content-hash 付きなので長期キャッシュ可。
app.use("/assets/*", serveStatic({ root: "./dist/client" }));
app.get("/favicon.ico", serveStatic({ path: "./dist/client/favicon.ico" }));

// それ以外は vike SSR に流す。
// pageContext.headers["cookie"] を各 +data が読んで API 認証に使う。
app.all("*", async (c) => {
  const pageContext = await renderPage({
    urlOriginal: c.req.url,
    headersOriginal: c.req.raw.headers,
  });
  const { httpResponse } = pageContext;
  if (!httpResponse) return c.notFound();
  return new Response(httpResponse.getReadableWebStream(), {
    status: httpResponse.statusCode,
    headers: httpResponse.headers,
  });
});

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`kuv web listening on http://localhost:${port}`);
```

- [ ] **Step 3: typecheck（server を含む）**

Run: `pnpm -F @kuv/web typecheck`
Expected: エラーなし（tsconfig の include に `server` を Task 2 で追加済み）。

- [ ] **Step 4: ビルドして本番サーバの起動をスモーク**

Run:
```bash
pnpm -F @kuv/web build
cd packages/web && PORT=3000 node server/index.ts &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login   # 200 を期待（login は +data 無しで開く）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/         # 302 を期待（未認証→/login。api 未起動でも UnauthorizedError ではなく接続失敗で 500 の可能性あり）
kill %1; cd ../..
```
Expected: `/login` が 200 を返し、SSR された HTML（`<!DOCTYPE html>` を含む）が出ること。`/` は api 未起動だと fetch 失敗で 500 になりうる（これは Task 8 の compose 実機確認で 302 を最終検証する）。`/login` の 200 と HTML 生成が確認できれば SSR サーバの配線は OK。

> `node server/index.ts` が「型ストリップ未対応」エラーになる場合（Node が 23.6 未満）のみ、暫定で `npx tsx server/index.ts` で確認する。本リポジトリは Node 24（mise 管理）なのでネイティブ実行が前提。

- [ ] **Step 5: Commit**

```bash
git add packages/web/server/index.ts packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): Hono + @hono/node-server の SSR サーバを追加"
```

---

## Task 7: デプロイ成果物を作り直す

**Files:**
- Modify: `packages/web/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `Caddyfile`
- Modify: `deploy/MIGRATION.md`

web を caddy 焼き込みから Node プロセス（self-contained）に変える。Caddy は薄いリバースプロキシに戻す。

- [ ] **Step 1: web/Dockerfile を差し替え**

`packages/web/Dockerfile` を全置換（`packages/api/Dockerfile` と同じ pnpm workspace パターン。runtime は `node server/index.ts`）:

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
RUN pnpm --filter @kuv/web deploy --prod --legacy /deploy

FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=build /deploy ./
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.ts"]
```

> `pnpm deploy` は build 済みの `dist` とソースの `server/` を含むパッケージ一式を `/deploy` に集める。runtime は cwd `/app` で `node server/index.ts` を実行し、`serveStatic({ root: "./dist/client" })` が `/app/dist/client` を配信、`renderPage` が `NODE_ENV=production` で `/app/dist/server` を読む。

- [ ] **Step 2: docker-compose.yml を差し替え**

`docker-compose.yml` を全置換（`web` サービス追加、`caddy` を素のイメージに）:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: kuv
      POSTGRES_USER: kuv
      POSTGRES_PASSWORD: kuv
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kuv -d kuv"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - db-data:/var/lib/postgresql/data

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    environment:
      PORT: 3001
      KUV_JWT_SECRET: ${KUV_JWT_SECRET}
      KUV_DB_HOST: postgres
      KUV_DB_USER: kuv
      KUV_DB_PASSWORD: kuv
      KUV_DB_DATABASE: kuv
    depends_on:
      postgres:
        condition: service_healthy

  web:
    build:
      context: .
      dockerfile: packages/web/Dockerfile
    environment:
      PORT: 3000
      KUV_API_BASE: http://api:3001
    depends_on:
      - api

  caddy:
    image: caddy:2-alpine
    ports:
      - "8080:80"
    volumes:
      # Caddyfile だけは bind-mount（設定変更でイメージ再ビルドしないため）
      - ./Caddyfile:/etc/caddy/Caddyfile
    depends_on:
      - web
      - api

volumes:
  db-data:
```

- [ ] **Step 3: Caddyfile を差し替え**

`Caddyfile` を全置換（静的配信 → web へ proxy）:

```caddyfile
:80 {
	handle /api/* {
		reverse_proxy api:3001
	}
	handle /i/* {
		reverse_proxy api:3001
	}
	handle {
		reverse_proxy web:3000
	}
}
```

- [ ] **Step 4: MIGRATION.md の §3 を更新**

`deploy/MIGRATION.md` の §3 スモーク部分を編集する。`curl -sf http://localhost:8080/ | head -3` のコメントを更新し、web サービスが増えたことを一文添える。

`## 3. 新スタックの起動確認（空 DB でのスモーク）` の本文を以下に置き換え:

```markdown
compose は postgres / api / web / caddy の 4 サービス（web は SSR を行う Node プロセス、caddy は web へのリバースプロキシ）。

\```bash
docker compose up -d --build
# スキーマ適用（migration runner は無いので psql で直接）
docker compose exec -T postgres psql -U kuv -d kuv -v ON_ERROR_STOP=1 \
  < packages/shared/drizzle/0000_nostalgic_baron_zemo.sql
curl -sf http://localhost:8080/login | head -3   # SSR された HTML が返る
curl -s  http://localhost:8080/api/auth/me        # 401 JSON が返る
\```

両方返れば caddy / web / api / postgres の配線は正常。
```

（実ファイルでは ```\``` のエスケープは不要。コードブロックはそのまま ``` を使う。`/` は未認証だと `/login` に 302 されるため、スモークでは `/login` を直接叩いて 200/HTML を確認する。）

- [ ] **Step 5: Commit**

```bash
git add packages/web/Dockerfile docker-compose.yml Caddyfile deploy/MIGRATION.md
git commit -m "feat(deploy): web を SSR Node プロセス化し Caddy を proxy に変更"
```

---

## Task 8: 実機確認 → 後始末 → PR

**Files:**
- Delete: `docs/superpowers/HANDOFF-2026-06-18-web-ssr.md`
- `hack` ブランチ削除（local + origin）

- [ ] **Step 1: workspace 全体の検証**

```bash
pnpm -r typecheck
pnpm -r test      # api は testcontainers（docker 必須）
pnpm -r build
```
Expected: すべて成功。

- [ ] **Step 2: compose で実機 SSR 確認**

```bash
docker compose up -d --build
docker compose exec -T postgres psql -U kuv -d kuv -v ON_ERROR_STOP=1 \
  < packages/shared/drizzle/0000_nostalgic_baron_zemo.sql
```

手動確認（ブラウザ）:
- [ ] `/login` でログインできる。
- [ ] `/`（一覧）が SSR HTML で返る（`curl -s http://localhost:8080/ -H "Cookie: kuv_jwt=<ログイン後のcookie>" | head` で画像 `<a href="/image/...">` を含む）。
- [ ] **`/image/<既存id>` を新タブで開く・リロードする → 正しく画像 view が出る（index に誤 hydrate しない）**。これが本作業の主目的。
- [ ] 未認証で `/`・`/settings`・`/image/<id>` にアクセスすると `/login` に 302 される（`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:8080/` が `302 .../login`）。
- [ ] アップロード・削除・apikey 発行/失効・設定トグル・パスワード変更が従来どおり動く。

確認後:
```bash
docker compose down
```

- [ ] **Step 3: HANDOFF を削除**

```bash
git rm docs/superpowers/HANDOFF-2026-06-18-web-ssr.md
git commit -m "docs: SSR 化作業の引き継ぎメモを削除"
```

- [ ] **Step 4: PR を作成（main へ）**

```bash
git push -u origin feat/web-ssr
gh pr create --base main --title "web を vike SSR 化" --body "$(cat <<'EOF'
## 概要

kuv web を静的 SPA（ssr:false + prerender）から vike SSR（Hono + @hono/node-server の Node プロセス）に変更。動的ルート `/image/@id` の誤 hydrate（vikejs/vike#1476）を構造的に解消する。

## 主な変更
- api: 所有者一致の個別画像メタ `GET /api/image/:id` を追加（SSR の +data 用）
- web: `+config` を `ssr:true` に、`+guard` 廃止、各保護ページに `+data`（cookie 転送・401→/login）
- web: `lib/api` に SSR baseUrl 解決 + cookie 転送、コンポーネントを useData 由来の props 起点へ
- web: Hono SSR サーバ `server/index.ts` を追加
- deploy: web を self-contained な Node イメージ化、Caddy を `web:3000` への proxy に、compose に web サービス追加、MIGRATION.md 更新

設計: `docs/superpowers/specs/2026-06-18-kuv-web-ssr-design.md`
実装プラン: `docs/superpowers/plans/2026-06-18-kuv-web-ssr.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: マージ後に hack ブランチを削除**

PR がマージされたら（`13a2e18` の onHydrationEnd パッチは SSR 化で不要）:
```bash
git branch -D hack 2>/dev/null || true
git push origin --delete hack
```

---

## Self-Review（spec との突き合わせ）

- **SSR サーバ（Hono + @hono/node-server, port 3000, dist/client 静的配信）** → Task 6。✓
- **+config ssr:true / prerender 削除 / vike-react 維持** → Task 3。✓
- **各保護ページ +data（cookie 転送・401→redirect("/login")）／login は +data 無し** → Task 4。✓
- **+guard 廃止** → Task 3。✓
- **lib/api baseUrl 解決（SSR=KUV_API_BASE||http://api:3001 / client=空）＋ cookie 経路追加、既存クライアントシグネチャ不変** → Task 2。✓
- **コンポーネントを useData 起点へ（初期データ props / ミューテーションは従来 api）** → Task 5。✓
- **デプロイ作り直し（web Dockerfile / compose / Caddyfile / MIGRATION.md）** → Task 7。✓
- **テスト: lib/api の SSR 分岐 / +data の 401→redirect / 既存コンポーネントテスト追従 / 実機 e2e** → Task 2・4・5・8。✓
- **後始末: hack ブランチ削除** → Task 8。✓
- **image/@id 初期データの取得元** → 個別メタ API `GET /api/image/:id` を新設（ユーザ決定。spec の「api 非対象」を上書き）。Task 1。✓
- **非対象（Bun 化 / shared 変更 / ミューテーションのサーバアクション化 / SEO / vike-node）** → いずれも本プランに含めず。✓

型整合: `apiGet<T>(path, cookie?)`、`Data` 型（`{images}` / `{image}` / `{settings,apikeys}`）、`findImageForUser → ImageListEntry`、コンポーネント props（`initialImages` / `image` / `initialKeepOriginal` / `initialKeys`）は各タスク間で一貫。
