# Picsur Web SPA Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vike SPA の 4 ページ（/login・/ 一覧+アップロード・/image/:id・/settings）+ 認証ガード + API クライアントを実装し、自家用 image host の管理 UI を完成させる。

**Architecture:** ページコンポーネントの中身は `components/` の純 React コンポーネント（props 注入、vike 非依存）に置き、`pages/*/+Page.tsx` は pageContext を読む薄い皮にする — これで @testing-library/react + jsdom だけでスモークテストできる。API アクセスは `lib/api.ts` の薄い fetch ラッパに集約（401 は `UnauthorizedError`）。認証はルート共通の `pages/+guard.ts`（クライアント実行、未認証 → /login redirect）。

**Tech Stack:** Vike (ssr:false) + vike-react + React 19 + Tailwind 4 / Vitest + jsdom + @testing-library/react。設計は `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md`「フロントエンド」+「Phase 4 の決定事項」節。

---

## File Structure

- Modify: `packages/web/vite.config.ts` — dev proxy（/api・/i → localhost:3001）
- Create: `packages/web/vitest.config.ts` — jsdom 環境（vike plugin を読まない専用設定）
- Modify: `packages/web/package.json` — jsdom / @testing-library/react 追加、test script から `--passWithNoTests` を外す
- Create: `packages/web/lib/api.ts` — fetch ラッパ + API 型
- Create: `packages/web/pages/+guard.ts` — 共通認証ガード
- Modify: `packages/web/pages/+Layout.tsx` — ヘッダーナビ + logout
- Modify: `packages/web/pages/+config.ts` — `prerender: { partial: true }`（動的ルート対応）
- Create: `packages/web/components/LoginForm.tsx` / `HomePage.tsx` / `ImageView.tsx` / `KeepOriginalToggle.tsx` / `ApikeyManager.tsx` / `PasswordForm.tsx`（+ 各 .test.tsx）
- Create: `packages/web/pages/login/+Page.tsx` / `pages/image/@id/+Page.tsx` / `pages/settings/+Page.tsx`
- Modify: `packages/web/pages/index/+Page.tsx`

注: 画像メタ単体取得の API は無いので、`/image/:id` ページのメタは `GET /api/image/list` から find する（自家用・メタのみで軽量なので許容。設計済み）。

---

## Task 1: テスト基盤 + dev proxy

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`
- Modify: `packages/web/vite.config.ts`

- [x] **Step 1: 依存追加**

Run:
```bash
cd packages/web
pnpm add -D jsdom @testing-library/react
```

- [x] **Step 2: test script の更新 — `packages/web/package.json`**

`"test": "vitest run --passWithNoTests"` を `"test": "vitest run"` に変更。

- [x] **Step 3: vitest 設定 — `packages/web/vitest.config.ts`（新規）**

vike plugin を含む vite.config.ts を vitest に読ませない（vike はテスト環境で動かない）ための専用設定:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
```

- [x] **Step 4: dev proxy — `packages/web/vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vike from "vike/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), vike(), tailwindcss()],
  server: {
    // dev では vite が web を配信するので、api への経路をプロキシして単一オリジン化（本番は Caddy）
    proxy: {
      "/api": "http://localhost:3001",
      "/i": "http://localhost:3001",
    },
  },
});
```

- [x] **Step 5: 基盤確認**

動作確認用に一時ファイル `packages/web/lib/smoke.test.tsx` を作る:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("jsdom + testing-library works", () => {
  render(<p>hello</p>);
  expect(screen.getByText("hello")).toBeDefined();
});
```

Run: `pnpm --filter @picsur/web test`
Expected: 1 passed。

確認後、一時ファイルを削除: `rm packages/web/lib/smoke.test.tsx`（lib/ ディレクトリ自体は次タスクで使うので `mkdir -p` で残してよいが、空なら消えていても問題ない）

- [x] **Step 6: build 回帰 + Commit**

Run: `pnpm --filter @picsur/web build && pnpm --filter @picsur/web typecheck`
Expected: 成功。

```bash
git add packages/web/package.json packages/web/vitest.config.ts packages/web/vite.config.ts pnpm-lock.yaml
git commit -m "test(web): add jsdom test harness and dev api proxy"
```

---

## Task 2: API クライアント（TDD）

**Files:**
- Create: `packages/web/lib/api.ts`
- Test: `packages/web/lib/api.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/web/lib/api.test.ts`**

```ts
import { afterEach, expect, test, vi } from "vitest";
import { apiDelete, apiGet, apiPost, apiPut, UnauthorizedError, uploadImage } from "./api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("apiGet returns parsed json", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  const r = await apiGet<{ ok: boolean }>("/api/health");
  expect(r).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledWith("/api/health", undefined);
});

test("401 throws UnauthorizedError", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
  await expect(apiGet("/api/auth/me")).rejects.toBeInstanceOf(UnauthorizedError);
});

test("non-ok throws Error with server message", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ error: "unsupported file type" }, 415));
  await expect(apiGet("/api/image")).rejects.toThrow("unsupported file type");
});

test("apiPost sends json body", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  await apiPost("/api/auth/login", { username: "a", password: "b" });
  const [, init] = fetchMock.mock.calls[0]!;
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ "content-type": "application/json" });
  expect(JSON.parse(init.body)).toEqual({ username: "a", password: "b" });
});

test("apiPost without body sends no content-type", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  await apiPost("/api/auth/logout");
  const [, init] = fetchMock.mock.calls[0]!;
  expect(init.method).toBe("POST");
  expect(init.headers).toBeUndefined();
  expect(init.body).toBeUndefined();
});

test("apiPut and apiDelete use the right methods", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  await apiPut("/api/settings", { keep_original: true });
  expect(fetchMock.mock.calls[0]![1].method).toBe("PUT");
  await apiDelete("/api/apikey/x");
  expect(fetchMock.mock.calls[1]![1].method).toBe("DELETE");
});

test("uploadImage posts multipart form data", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ id: "abc", file_name: "a.png", links: { view: "/i/abc", direct: "/i/abc.png" } }),
  );
  const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
  const r = await uploadImage(file);
  expect(r.id).toBe("abc");
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/image");
  expect(init.method).toBe("POST");
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get("file")).toBe(file);
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/web test api`
Expected: FAIL（`./api` が無い）

- [x] **Step 3: 実装 — `packages/web/lib/api.ts`**

```ts
// api レスポンス型（api 側は snake_case で統一されている）
export interface ImageLinks {
  view: string;
  direct: string;
}

export interface ImageEntry {
  id: string;
  file_name: string;
  created: string;
  master_filetype: string;
  links: ImageLinks;
}

export interface ApikeyEntry {
  id: string;
  name: string;
  key: string;
  created: string;
  last_used: string | null;
}

export interface Settings {
  keep_original: boolean;
}

export interface Me {
  user: { id: string; username: string };
}

export interface UploadResult {
  id: string;
  file_name: string;
  links: ImageLinks;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

// multipart アップロード（content-type はブラウザが boundary 付きで自動設定）
export function uploadImage(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  return request<UploadResult>("/api/image", { method: "POST", body: fd });
}
```

- [x] **Step 4: テスト緑を確認 + typecheck**

Run: `pnpm --filter @picsur/web test api && pnpm --filter @picsur/web typecheck`
Expected: PASS（7 test）、typecheck エラー無し。

- [x] **Step 5: Commit**

```bash
git add packages/web/lib/api.ts packages/web/lib/api.test.ts
git commit -m "feat(web): add typed api client with unauthorized error"
```

---

## Task 3: 認証ガード + Layout ヘッダー

**Files:**
- Create: `packages/web/pages/+guard.ts`
- Modify: `packages/web/pages/+Layout.tsx`

- [x] **Step 1: ガード実装 — `packages/web/pages/+guard.ts`（新規）**

```ts
import { redirect } from "vike/abort";
import type { GuardAsync } from "vike/types";

// 全ページ共通の認証ガード（ssr:false なのでクライアントで実行される）。
// /login だけは未認証で開ける。それ以外は /api/auth/me が 401 なら /login へ。
const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  // prerender（build 時、node 環境）では認証チェック不能なので素通り
  if (typeof window === "undefined") return;
  if (pageContext.urlPathname === "/login") return;

  const res = await fetch("/api/auth/me");
  if (res.status === 401) {
    throw redirect("/login");
  }
};

export { guard };
```

- [x] **Step 2: Layout にヘッダーナビ + logout — `packages/web/pages/+Layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { apiPost } from "../lib/api";
import "./tailwind.css";

function Header() {
  const onLogout = async () => {
    await apiPost("/api/auth/logout");
    // ガードに任せず明示的に遷移（full reload で状態も破棄）
    window.location.href = "/login";
  };

  return (
    <header className="flex items-center gap-6 border-b border-neutral-800 px-6 py-3">
      <a href="/" className="text-lg font-bold">
        Picsur
      </a>
      <nav className="flex flex-1 gap-4 text-sm text-neutral-400">
        <a href="/" className="hover:text-neutral-100">
          Images
        </a>
        <a href="/settings" className="hover:text-neutral-100">
          Settings
        </a>
      </nav>
      <button
        type="button"
        onClick={onLogout}
        className="text-sm text-neutral-400 hover:text-neutral-100"
      >
        Logout
      </button>
    </header>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const pageContext = usePageContext();
  const isLogin = pageContext.urlPathname === "/login";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {!isLogin && <Header />}
      {children}
    </div>
  );
}
```

- [x] **Step 3: build + typecheck で確認**

guard と Layout は vike runtime 依存なのでユニットテストはせず、build / typecheck で担保する（ページコンポーネントのスモークは後続タスク）。

Run: `pnpm --filter @picsur/web build && pnpm --filter @picsur/web typecheck && pnpm --filter @picsur/web test`
Expected: build 成功（prerender 含む）、typecheck エラー無し、既存 api テスト 7 PASS。

> もし build の prerender 段階で guard 関連のエラーが出る場合は、エラー内容を報告すること（`typeof window === "undefined"` ガードで素通りするはずだが、vike のバージョンによって guard が prerender で呼ばれない場合もある — どちらでも成立する設計）。

- [x] **Step 4: Commit**

```bash
git add packages/web/pages/+guard.ts packages/web/pages/+Layout.tsx
git commit -m "feat(web): add auth guard and header navigation"
```

---

## Task 4: ログインページ（TDD スモーク）

**Files:**
- Create: `packages/web/components/LoginForm.tsx`
- Test: `packages/web/components/LoginForm.test.tsx`
- Create: `packages/web/pages/login/+Page.tsx`

- [x] **Step 1: 失敗するテストを書く — `packages/web/components/LoginForm.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

test("submits credentials and calls onLoggedIn on success", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ user: { id: "u1", username: "admin" } }), {
      status: 200,
    }),
  );
  const onLoggedIn = vi.fn();
  render(<LoginForm onLoggedIn={onLoggedIn} />);

  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));

  await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/auth/login");
  expect(JSON.parse(init.body)).toEqual({
    username: "admin",
    password: "hunter2",
  });
});

test("shows an error on failed login", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: "invalid credentials" }), {
      status: 401,
    }),
  );
  render(<LoginForm onLoggedIn={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));

  await waitFor(() =>
    expect(screen.getByText("login failed")).toBeDefined(),
  );
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/web test LoginForm`
Expected: FAIL（`./LoginForm` が無い）

- [x] **Step 3: 実装 — `packages/web/components/LoginForm.tsx`**

```tsx
import { useState } from "react";
import { apiPost } from "../lib/api";
import type { Me } from "../lib/api";

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost<Me>("/api/auth/login", { username, password });
      onLoggedIn();
    } catch {
      setError("login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-32 flex w-72 flex-col gap-4">
      <h1 className="text-center text-2xl font-bold">Picsur</h1>
      <label className="flex flex-col gap-1 text-sm">
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="username"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 py-2 font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        Login
      </button>
    </form>
  );
}
```

- [x] **Step 4: ページの皮 — `packages/web/pages/login/+Page.tsx`（新規）**

```tsx
import { navigate } from "vike/client/router";
import { LoginForm } from "../../components/LoginForm";

export default function Page() {
  return <LoginForm onLoggedIn={() => navigate("/")} />;
}
```

- [x] **Step 5: テスト緑 + build 確認**

Run: `pnpm --filter @picsur/web test LoginForm && pnpm --filter @picsur/web build && pnpm --filter @picsur/web typecheck`
Expected: 2 test PASS、build / typecheck 成功。

- [x] **Step 6: Commit**

```bash
git add packages/web/components/LoginForm.tsx packages/web/components/LoginForm.test.tsx packages/web/pages/login/
git commit -m "feat(web): add login page"
```

---

## Task 5: ホームページ — アップロード + 一覧（TDD スモーク）

**Files:**
- Create: `packages/web/components/HomePage.tsx`
- Test: `packages/web/components/HomePage.test.tsx`
- Modify: `packages/web/pages/index/+Page.tsx`

- [x] **Step 1: 失敗するテストを書く — `packages/web/components/HomePage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HomePage } from "./HomePage";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

const listResponse = {
  images: [
    {
      id: "img1",
      file_name: "cat.png",
      created: "2026-06-05T00:00:00Z",
      master_filetype: "image/png",
      links: { view: "/i/img1", direct: "/i/img1.png" },
    },
  ],
};

test("renders the image list from the api", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(listResponse), { status: 200 }),
  );
  render(<HomePage />);

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  const img = screen.getByAltText("cat.png") as HTMLImageElement;
  expect(img.src).toContain("/i/img1");
  // 一覧 API が呼ばれた
  expect(fetchMock.mock.calls[0]![0]).toBe("/api/image/list");
});

test("uploads a selected file and refreshes the list", async () => {
  // 1回目: 初期一覧（空）/ 2回目: アップロード / 3回目: 再取得一覧
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ images: [] }), { status: 200 }),
    )
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

  render(<HomePage />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());

  const file = new File([new Uint8Array([1])], "cat.png", {
    type: "image/png",
  });
  const input = screen.getByLabelText("Upload") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  // 2回目の呼び出しが multipart アップロード
  const [path, init] = fetchMock.mock.calls[1]!;
  expect(path).toBe("/api/image");
  expect(init.body).toBeInstanceOf(FormData);
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/web test HomePage`
Expected: FAIL（`./HomePage` が無い）

- [x] **Step 3: 実装 — `packages/web/components/HomePage.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { apiGet, uploadImage } from "../lib/api";
import type { ImageEntry } from "../lib/api";

export function HomePage() {
  const [images, setImages] = useState<ImageEntry[]>([]);
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

  useEffect(() => {
    void reload();
  }, [reload]);

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

> 注意: `label` の中に hidden input を置く構成で `getByLabelText("Upload")` が引けるよう `aria-label="Upload"` を input に付けている。

- [x] **Step 4: ページの皮 — `packages/web/pages/index/+Page.tsx`**

```tsx
import { HomePage } from "../../components/HomePage";

export default function Page() {
  return <HomePage />;
}
```

- [x] **Step 5: テスト緑 + build 確認**

Run: `pnpm --filter @picsur/web test HomePage && pnpm --filter @picsur/web build && pnpm --filter @picsur/web typecheck`
Expected: 2 test PASS、build / typecheck 成功。

- [x] **Step 6: Commit**

```bash
git add packages/web/components/HomePage.tsx packages/web/components/HomePage.test.tsx packages/web/pages/index/+Page.tsx
git commit -m "feat(web): add home page with upload and image grid"
```

---

## Task 6: 画像 view ページ + prerender partial（TDD スモーク）

**Files:**
- Create: `packages/web/components/ImageView.tsx`
- Test: `packages/web/components/ImageView.test.tsx`
- Create: `packages/web/pages/image/@id/+Page.tsx`
- Modify: `packages/web/pages/+config.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/web/components/ImageView.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ImageView } from "./ImageView";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

const listResponse = {
  images: [
    {
      id: "img1",
      file_name: "cat.png",
      created: "2026-06-05T00:00:00Z",
      master_filetype: "image/png",
      links: { view: "/i/img1", direct: "/i/img1.png" },
    },
  ],
};

test("renders image, metadata and direct link", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(listResponse), { status: 200 }),
  );
  render(<ImageView id="img1" onDeleted={vi.fn()} />);

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  expect(screen.getByText("cat.png")).toBeDefined();
  // direct リンクのコピー UI が出ている
  expect(screen.getByText("/i/img1.png")).toBeDefined();
});

test("shows not found for an unknown id", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ images: [] }), { status: 200 }),
  );
  render(<ImageView id="missing" onDeleted={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("image not found")).toBeDefined());
});

test("deletes after confirmation and calls onDeleted", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify(listResponse), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  const onDeleted = vi.fn();
  render(<ImageView id="img1" onDeleted={onDeleted} />);

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls[1]!;
  expect(path).toBe("/api/image/img1");
  expect(init.method).toBe("DELETE");
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/web test ImageView`
Expected: FAIL（`./ImageView` が無い）

- [x] **Step 3: 実装 — `packages/web/components/ImageView.tsx`**

メタ単体取得 API は無いので一覧から find する（設計済みの判断）:

```tsx
import { useEffect, useState } from "react";
import { apiDelete, apiGet } from "../lib/api";
import type { ImageEntry } from "../lib/api";

export function ImageView({
  id,
  onDeleted,
}: {
  id: string;
  onDeleted: () => void;
}) {
  const [image, setImage] = useState<ImageEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { images } = await apiGet<{ images: ImageEntry[] }>(
          "/api/image/list",
        );
        setImage(images.find((im) => im.id === id) ?? null);
      } catch {
        setError("failed to load image");
      } finally {
        setLoaded(true);
      }
    })();
  }, [id]);

  const onCopy = async () => {
    if (!image) return;
    await navigator.clipboard.writeText(
      new URL(image.links.direct, window.location.origin).href,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onDelete = async () => {
    if (!image) return;
    if (!confirm(`Delete ${image.file_name}?`)) return;
    try {
      await apiDelete(`/api/image/${image.id}`);
      onDeleted();
    } catch {
      setError("delete failed");
    }
  };

  if (!loaded) return <main className="p-6 text-neutral-500">loading…</main>;
  if (error) return <main className="p-6 text-red-400">{error}</main>;
  if (!image) return <main className="p-6 text-neutral-500">image not found</main>;

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
      </div>
    </main>
  );
}
```

- [x] **Step 4: ページの皮 — `packages/web/pages/image/@id/+Page.tsx`（新規）**

```tsx
import { navigate } from "vike/client/router";
import { usePageContext } from "vike-react/usePageContext";
import { ImageView } from "../../../components/ImageView";

export default function Page() {
  const pageContext = usePageContext();
  const id = pageContext.routeParams!.id!;
  return <ImageView id={id} onDeleted={() => navigate("/")} />;
}
```

- [x] **Step 5: prerender を partial に — `packages/web/pages/+config.ts`**

動的ルート（`@id`）は prerender できないため、prerender 可能なページだけ prerender する設定に変更:

```ts
import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  ssr: false,
  // 動的ルート（/image/@id）は prerender 不能なので partial にする。
  // prerender されないページは Caddy / vite の SPA fallback で index.html が配信される
  prerender: { partial: true },
  extends: vikeReact,
} satisfies Config;
```

> 注意: `prerender: { partial: true }` で build 時の「cannot prerender」警告が抑止される想定。build が動的ルートでエラーになる場合は、`pages/image/@id/+prerender.ts` に `export default false` を置く方式も試し、結果を報告すること。

- [x] **Step 6: テスト緑 + build 確認**

Run: `pnpm --filter @picsur/web test ImageView && pnpm --filter @picsur/web build && pnpm --filter @picsur/web typecheck`
Expected: 3 test PASS、build（partial prerender）成功、typecheck エラー無し。

- [x] **Step 7: Commit**

```bash
git add packages/web/components/ImageView.tsx packages/web/components/ImageView.test.tsx packages/web/pages/image/ packages/web/pages/+config.ts
git commit -m "feat(web): add image view page with copy and delete"
```

---

## Task 7: settings ページ（TDD スモーク）

**Files:**
- Create: `packages/web/components/KeepOriginalToggle.tsx` + `KeepOriginalToggle.test.tsx`
- Create: `packages/web/components/ApikeyManager.tsx` + `ApikeyManager.test.tsx`
- Create: `packages/web/components/PasswordForm.tsx` + `PasswordForm.test.tsx`
- Create: `packages/web/pages/settings/+Page.tsx`

- [x] **Step 1: 失敗するテストを書く (a) — `packages/web/components/KeepOriginalToggle.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { KeepOriginalToggle } from "./KeepOriginalToggle";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

test("loads the current setting and toggles it", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ keep_original: false }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ keep_original: true }), { status: 200 }),
    );
  render(<KeepOriginalToggle />);

  const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);

  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox.checked).toBe(true));

  const [path, init] = fetchMock.mock.calls[1]!;
  expect(path).toBe("/api/settings");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ keep_original: true });
});
```

- [x] **Step 2: 失敗するテストを書く (b) — `packages/web/components/ApikeyManager.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ApikeyManager } from "./ApikeyManager";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

const key1 = {
  id: "k1",
  name: "sharex",
  key: "AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH",
  created: "2026-06-05T00:00:00Z",
  last_used: null,
};

test("lists keys and issues a new one", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ apikeys: [key1] }), { status: 200 }),
    )
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
  render(<ApikeyManager />);

  await waitFor(() => expect(screen.getByText("sharex")).toBeDefined());

  fireEvent.click(screen.getByRole("button", { name: "New key" }));
  await waitFor(() => expect(screen.getByText("new")).toBeDefined());
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/apikey");
  expect(fetchMock.mock.calls[1]![1].method).toBe("POST");
});

test("revokes a key after confirmation", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ apikeys: [key1] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ apikeys: [] }), { status: 200 }),
    );
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  render(<ApikeyManager />);

  await waitFor(() => expect(screen.getByText("sharex")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

  await waitFor(() => expect(screen.queryByText("sharex")).toBeNull());
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/apikey/k1");
  expect(fetchMock.mock.calls[1]![1].method).toBe("DELETE");
});
```

- [x] **Step 3: 失敗するテストを書く (c) — `packages/web/components/PasswordForm.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PasswordForm } from "./PasswordForm";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

test("submits current and new password", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  render(<PasswordForm />);

  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "old" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-pass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  await waitFor(() => expect(screen.getByText("password changed")).toBeDefined());
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/auth/password");
  expect(JSON.parse(init.body)).toEqual({ current: "old", new: "new-pass" });
});

test("shows an error when the current password is wrong", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: "invalid credentials" }), {
      status: 401,
    }),
  );
  render(<PasswordForm />);

  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "wrong" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-pass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  await waitFor(() =>
    expect(screen.getByText("password change failed")).toBeDefined(),
  );
});
```

- [x] **Step 4: テスト失敗を確認**

Run: `pnpm --filter @picsur/web test components/`
Expected: 新規 3 ファイルがモジュール不在で FAIL（LoginForm/HomePage/ImageView は PASS のまま）

- [x] **Step 5: 実装 (a) — `packages/web/components/KeepOriginalToggle.tsx`**

```tsx
import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../lib/api";
import type { Settings } from "../lib/api";

export function KeepOriginalToggle() {
  const [keepOriginal, setKeepOriginal] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<Settings>("/api/settings")
      .then((s) => setKeepOriginal(s.keep_original))
      .catch(() => setError("failed to load settings"));
  }, []);

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

  if (keepOriginal === null && !error) {
    return <p className="text-sm text-neutral-500">loading…</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={keepOriginal ?? false}
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

- [x] **Step 6: 実装 (b) — `packages/web/components/ApikeyManager.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import type { ApikeyEntry } from "../lib/api";

export function ApikeyManager() {
  const [keys, setKeys] = useState<ApikeyEntry[]>([]);
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

  useEffect(() => {
    void reload();
  }, [reload]);

  const onIssue = async () => {
    setError(null);
    try {
      await apiPost("/api/apikey", {});
      await reload();
    } catch {
      setError("failed to issue a key");
    }
  };

  const onRevoke = async (k: ApikeyEntry) => {
    if (!confirm(`Revoke "${k.name}"?`)) return;
    setError(null);
    try {
      await apiDelete(`/api/apikey/${k.id}`);
      await reload();
    } catch {
      setError("failed to revoke the key");
    }
  };

  const onCopy = async (k: ApikeyEntry) => {
    await navigator.clipboard.writeText(k.key);
    setCopiedId(k.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onIssue}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          New key
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      <ul className="flex flex-col gap-2">
        {keys.map((k) => (
          <li
            key={k.id}
            className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2 text-sm"
          >
            <span className="w-32 truncate font-medium">{k.name}</span>
            <button
              type="button"
              onClick={() => onCopy(k)}
              className="flex-1 truncate text-left font-mono text-xs text-neutral-400 hover:text-neutral-100"
              title="Copy key"
            >
              {copiedId === k.id ? "copied!" : k.key}
            </button>
            <button
              type="button"
              onClick={() => onRevoke(k)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {keys.length === 0 && (
        <p className="text-sm text-neutral-500">No api keys.</p>
      )}
    </div>
  );
}
```

- [x] **Step 7: 実装 (c) — `packages/web/components/PasswordForm.tsx`**

```tsx
import { useState } from "react";
import { apiPost } from "../lib/api";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiPost("/api/auth/password", { current, new: next });
      setStatus("done");
      setCurrent("");
      setNext("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex w-72 flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Current password
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        New password
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="new-password"
        />
      </label>
      {status === "done" && (
        <p className="text-sm text-green-400">password changed</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-400">password change failed</p>
      )}
      <button
        type="submit"
        className="rounded bg-blue-600 py-2 text-sm font-medium hover:bg-blue-500"
      >
        Change password
      </button>
    </form>
  );
}
```

- [x] **Step 8: ページの皮 — `packages/web/pages/settings/+Page.tsx`（新規）**

```tsx
import { ApikeyManager } from "../../components/ApikeyManager";
import { KeepOriginalToggle } from "../../components/KeepOriginalToggle";
import { PasswordForm } from "../../components/PasswordForm";

export default function Page() {
  return (
    <main className="flex flex-col gap-10 p-6">
      <section>
        <h2 className="mb-3 text-lg font-bold">Upload</h2>
        <KeepOriginalToggle />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">API keys</h2>
        <ApikeyManager />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">Password</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
```

- [x] **Step 9: テスト緑 + build 確認**

Run: `pnpm --filter @picsur/web test && pnpm --filter @picsur/web build && pnpm --filter @picsur/web typecheck`
Expected: 全 web テスト PASS（api 7 + LoginForm 2 + HomePage 2 + ImageView 3 + KeepOriginalToggle 1 + ApikeyManager 2 + PasswordForm 2 = 19）、build / typecheck 成功。

- [x] **Step 10: Commit**

```bash
git add packages/web/components/ packages/web/pages/settings/
git commit -m "feat(web): add settings page (keep_original, apikeys, password)"
```

---

## Task 8: 最終確認

- [x] **Step 1: ワークスペース全体の緑確認**

Run: `pnpm -r test && pnpm -r build && pnpm -r typecheck`
Expected: shared / api / web 全テスト PASS（api は docker 必要）、build / typecheck 全緑。

- [x] **Step 2: dev での手動疎通（実 api + 実ブラウザ相当の確認）**

testcontainers ではなく dev 環境での疎通確認。以下を実行して、curl レベルで SPA シェルと api が同一オリジンで繋がることを確認:

```bash
# devdb（compose の postgres）を起動して api を立てる準備が無い場合は、
# このステップは「vite dev が起動して / が index.html を返す」ことだけ確認すれば良い:
cd packages/web
pnpm dev &
sleep 3
curl -s http://localhost:5173/ | head -5   # SPA シェルの HTML が返る
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/api/health  # api 未起動なら 500/502 系（proxy が効いている証拠）
kill %1
```

Expected: `/` で HTML、`/api/health` は proxy 試行の痕跡（api 未起動でも proxy 設定が効いていることが分かるエラー）。実 api を立てた full 疎通は Phase 5（デプロイ）で行う。

- [x] **Step 3: Commit（変更があれば）**

新規変更が無ければ commit 不要。

---

## 完了条件

- `/login` で admin ログイン → `/` へ。未認証で保護ページを開くと guard が `/login` に redirect（ssr:false のクライアント実行、prerender 時は素通り）。
- `/` でファイル選択アップロード（完了で一覧更新）+ サムネグリッド（`/i/{id}` を CSS 縮小、クリックで `/image/{id}`）。
- `/image/:id` で画像 + メタ + direct リンクコピー + 確認付き削除（→ `/`）。
- `/settings` で keep_original トグル / apikey 発行・平文コピー・失効 / パスワード変更。
- ヘッダーナビ（/login では非表示）+ logout。
- web テスト 19 本（api クライアント + 各コンポーネントのスモーク）緑、`pnpm -r test/build/typecheck` 全緑。
- 後続: Phase 5（デプロイ: Dockerfile 仕上げ / compose / 実 DB 移行）。

## 実装完了メモ（2026-06-06、最終レビュー済み）

全 8 タスク完了（`591e9ca`〜`990bdbe`）。web 19 + api 100 + shared 10 テスト / `pnpm -r build` / `pnpm -r typecheck` 全緑。dev 疎通確認済み（**vike dev は port 3000**、proxy 経由 /api/health 200、SPA シェル配信）。最終レビュー verdict: Ready to merge。

**途中で直した点:** logout 失敗時も /login へ遷移 / fetch モックの Response 再消費対策（mockImplementation パターン）/ cleanup() を afterEach に明示（globals:false のため）。

**既知の許容事項（YAGNI）:**
- ページ滞在中のセッション失効は in-page fetch がジェネリックエラー表示になるだけで自動リダイレクトしない（再ナビゲーションで guard が効く）。`UnauthorizedError` はクライアント側で名前指定 catch されていない。
- guard はナビゲーション毎に /api/auth/me を 1 往復（自家用で許容）。

**Phase 5（デプロイ）への引き継ぎ:**
- Caddyfile の `try_files {path} /index.html` で、prerender 済み `/settings`・`/login` はディレクトリ index 解決、`/image/:id` は SPA fallback になる — E2E で要確認。
- `<img src="/i/...">` は cookie 認証依存。Caddy の reverse_proxy が cookie を転送すること（デフォルトで転送される）を実機確認。
- ポート整合は確認済み（dev proxy / Caddy / api すべて 3001）。
