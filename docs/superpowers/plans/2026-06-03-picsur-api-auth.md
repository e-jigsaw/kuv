# Picsur API Auth Implementation Plan (Phase 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@picsur/api` に DB 接続（pg + Drizzle）、パスワード/JWT ユーティリティ、認証ミドルウェア（JWT cookie + apikey）、認証ルート（login / logout / me）、testcontainers ベースの DB 統合テスト基盤を実装する。

**Architecture:** api は `@picsur/shared` の Drizzle スキーマを import し、`drizzle(pgPool, { schema })` で DB クライアントを作る。認証は二系統 — 管理者の **JWT を httpOnly cookie** で持つ（`hono/jwt` + `hono/cookie`）、ShareX 等は **apikey**（`Authorization: Api-Key <key>` ヘッダ or `?key=` クエリ）。ミドルウェアが両者を解決して `c.var.user` を埋める。テストは testcontainers で使い捨て Postgres を立て、migration 適用 + admin seed して `app.request()` で検証する。

**Tech Stack:** Hono, `hono/jwt`, `hono/cookie`, Drizzle (`drizzle-orm/node-postgres`), `pg`, `bcrypt`, Vitest, `@testcontainers/postgresql`。

このプランは spec `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「実装フェーズ 3（api）」の前半（DB接続 + 認証）に対応する。画像パイプライン（upload/配信/変換/削除）は Plan 3b、settings/apikey 管理/ShareX は Plan 3c で扱う。

---

## 設計判断（レビュー対象）

1. **JWT = `hono/jwt`**（依存追加なし）。payload `{ uid: <userId>, exp: <unix> }`。secret は env `PICSUR_JWT_SECRET`（必須）。httpOnly cookie 名 `picsur_jwt`。有効期限はデフォルト 7日。
2. **パスワード = bcrypt**（旧実装と同じ）。既存 prod の admin の `hashed_password`（bcrypt）と互換を保ち、Plan 5 の prod 引き継ぎ後もそのままログインできる。
3. **apikey** は `Authorization: Api-Key <key>` ヘッダ、または `?key=<key>` クエリ（画像直リン用）で受け取り、`apikey` テーブルを引いて admin user に解決。`last_used` を更新。
4. **認可は二値**。ミドルウェアは「JWT cookie か apikey が有効なら `c.var.user` にユーザーを、無ければ `null`」を入れるだけ。各ルートで要否を判定する（`requireAuth` ヘルパ）。Plan 3b で `/i` を含む全ルートに適用する。
5. **DB クライアント**は api の `src/db.ts` に1つ（pg Pool + drizzle）。env `PICSUR_DB_*` から接続。
6. **テスト DB** は testcontainers（`postgres:17-alpine`）。`src/test/db.ts` のヘルパが「コンテナ起動 → migration SQL 適用 → drizzle 返却 → teardown」を担う。admin seed ヘルパも提供。
7. **タイミング攻撃緩和**: login は失敗/成功にかかわらず最低 ~400ms かける（旧実装踏襲、単一 admin だが安価なので踏襲）。

> **バージョン注記**: `pg`/`@types/pg`/`bcrypt`/`@types/bcrypt`/`@testcontainers/postgresql` のバージョンは目安。解決できない/API が違う場合は最新安定版に合わせ、変更点を報告する。

---

## File Structure

- `packages/api/package.json` — deps 追加（modify）
- `packages/api/src/db.ts` — pg Pool + Drizzle クライアント（create）
- `packages/api/src/env.ts` — env 読み出しヘルパ（create）
- `packages/api/src/auth/password.ts` — bcrypt ハッシュ/照合（create）
- `packages/api/src/auth/password.test.ts` — （create）
- `packages/api/src/auth/jwt.ts` — hono/jwt sign/verify ラッパ（create）
- `packages/api/src/auth/jwt.test.ts` — （create）
- `packages/api/src/db/queries.ts` — getUserByUsername / getUserById / resolveApikey（create）
- `packages/api/src/middleware/auth.ts` — 認証ミドルウェア + requireAuth（create）
- `packages/api/src/routes/auth.ts` — login / logout / me ルート（create）
- `packages/api/src/app.ts` — auth ルートを mount（modify）
- `packages/api/src/types.ts` — Hono の Variables 型（`user`）（create）
- `packages/api/src/test/db.ts` — testcontainers ヘルパ + seed（create）
- `packages/api/src/routes/auth.test.ts` — 統合テスト（create）
- `packages/api/vitest.config.ts` — testcontainers 用に testTimeout 延長（create）

---

## Task 1: api 依存追加と env / DB クライアント

**Files:**
- Modify: `packages/api/package.json`
- Create: `packages/api/src/env.ts`
- Create: `packages/api/src/db.ts`

- [ ] **Step 1: package.json に依存追加**

`dependencies` / `devDependencies` を以下に更新（既存 hono / @hono/node-server / @picsur/shared は維持、drizzle-orm・pg・bcrypt を追加、testcontainers を devDeps に）:

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
    "@picsur/shared": "workspace:*",
    "bcrypt": "^5.1.1",
    "drizzle-orm": "^0.38.0",
    "hono": "^4.6.0",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.13.0",
    "@types/bcrypt": "^5.0.2",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.0",
    "testcontainers": "^10.13.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: env ヘルパを作成 — `packages/api/src/env.ts`**

```ts
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const env = {
  jwtSecret: () => required("PICSUR_JWT_SECRET"),
  port: () => Number(optional("PORT", "3001")),
  db: () => ({
    host: optional("PICSUR_DB_HOST", "localhost"),
    port: Number(optional("PICSUR_DB_PORT", "5432")),
    user: optional("PICSUR_DB_USER", "picsur"),
    password: optional("PICSUR_DB_PASSWORD", "picsur"),
    database: optional("PICSUR_DB_DATABASE", "picsur"),
  }),
};
```

- [ ] **Step 3: DB クライアントを作成 — `packages/api/src/db.ts`**

```ts
import {
  apikey,
  image,
  imageDerivative,
  imageFile,
  settings,
  user,
} from "@picsur/shared";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "./env";

// drizzle に渡すのはテーブルだけ（version 定数や DTO は含めない）
const schema = { user, apikey, settings, image, imageFile, imageDerivative };

export type Db = ReturnType<typeof createDb>;

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

// アプリ用のシングルトン（pg.Pool は遅延接続なので import 時点では接続しない）。
// テストでは createDb に専用 pool を渡す。
export const pool = new pg.Pool(env.db());
export const db = createDb(pool);
```

- [ ] **Step 4: 依存を入れて typecheck**

Run: `pnpm install && pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

> `import * as schema from "@picsur/shared"` は version 定数や DTO も含むが、drizzle は schema オブジェクトからテーブルだけ拾うので問題ない。型エラーが出る場合は `import { user, apikey, image, imageFile, imageDerivative, settings } from "@picsur/shared"` で必要なテーブルだけ集めた `schema` オブジェクトを作る形に変えてよい（報告）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add db client (pg + drizzle) and env helpers"
```

---

## Task 2: パスワードユーティリティ（bcrypt, TDD）

**Files:**
- Create: `packages/api/src/auth/password.ts`
- Test: `packages/api/src/auth/password.test.ts`

- [x] **Step 1: 失敗するテストを書く — `packages/api/src/auth/password.test.ts`**

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("hashPassword produces a verifiable hash", async () => {
  const hash = await hashPassword("correct horse");
  expect(hash).not.toBe("correct horse");
  expect(await verifyPassword("correct horse", hash)).toBe(true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("correct horse");
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
```

- [x] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test password`
Expected: FAIL（`./password` が無い）

- [x] **Step 3: 実装 — `packages/api/src/auth/password.ts`**

```ts
import bcrypt from "bcrypt";

const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [x] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test password`
Expected: PASS（2 test）

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add bcrypt password hashing utilities"
```

---

## Task 3: JWT ユーティリティ（hono/jwt, TDD）

**Files:**
- Create: `packages/api/src/auth/jwt.ts`
- Test: `packages/api/src/auth/jwt.test.ts`

- [ ] **Step 1: 失敗するテストを書く — `packages/api/src/auth/jwt.test.ts`**

```ts
import { expect, test } from "vitest";
import { signAuthToken, verifyAuthToken } from "./jwt";

const SECRET = "test-secret";

test("signAuthToken then verifyAuthToken round-trips the uid", async () => {
  const token = await signAuthToken("user-123", SECRET);
  const payload = await verifyAuthToken(token, SECRET);
  expect(payload?.uid).toBe("user-123");
});

test("verifyAuthToken returns null for a bad token", async () => {
  expect(await verifyAuthToken("garbage", SECRET)).toBe(null);
});

test("verifyAuthToken returns null for a wrong secret", async () => {
  const token = await signAuthToken("user-123", SECRET);
  expect(await verifyAuthToken(token, "other-secret")).toBe(null);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @picsur/api test jwt`
Expected: FAIL（`./jwt` が無い）

- [ ] **Step 3: 実装 — `packages/api/src/auth/jwt.ts`**

```ts
import { sign, verify } from "hono/jwt";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface AuthPayload {
  uid: string;
  exp: number;
}

export async function signAuthToken(
  uid: string,
  secret: string,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return sign({ uid, exp }, secret);
}

export async function verifyAuthToken(
  token: string,
  secret: string,
): Promise<AuthPayload | null> {
  try {
    const payload = await verify(token, secret);
    if (typeof payload.uid !== "string") return null;
    return payload as unknown as AuthPayload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: テスト緑を確認**

Run: `pnpm --filter @picsur/api test jwt`
Expected: PASS（3 test）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add hono/jwt sign/verify wrappers"
```

---

## Task 4: testcontainers テスト基盤 + seed ヘルパ

**Files:**
- Create: `packages/api/vitest.config.ts`
- Create: `packages/api/src/test/db.ts`

- [ ] **Step 1: vitest 設定（testcontainers は起動が遅いので timeout 延長）— `packages/api/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 2: testcontainers ヘルパを作成 — `packages/api/src/test/db.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { createDb, type Db } from "../db";
import { user } from "@picsur/shared";

export interface TestDb {
  db: Db;
  pool: pg.Pool;
  container: StartedPostgreSqlContainer;
  teardown: () => Promise<void>;
}

// migration SQL の場所（packages/shared/drizzle/0000_*.sql）
function readMigrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const drizzleDir = join(here, "../../../shared/drizzle");
  const file = readdirSync(drizzleDir).find(
    (f) => f.startsWith("0000_") && f.endsWith(".sql"),
  );
  if (!file) throw new Error("migration SQL not found in " + drizzleDir);
  return readFileSync(join(drizzleDir, file), "utf8");
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });

  // migration を適用（"--> statement-breakpoint" は SQL コメントなので無視される）
  const sql = readMigrationSql();
  await pool.query(sql);

  const db = createDb(pool);

  return {
    db,
    pool,
    container,
    teardown: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

// admin ユーザーを1人 seed して id を返す
export async function seedAdmin(
  db: Db,
  username: string,
  passwordHash: string,
): Promise<string> {
  const [row] = await db
    .insert(user)
    .values({ username, password: passwordHash })
    .returning({ id: user.id });
  return row!.id;
}
```

> `node:fs/promises` の `glob` が無い Node 版の場合は、`readdirSync(drizzleDir).find(f => f.startsWith("0000_") && f.endsWith(".sql"))` で代替してよい（報告）。

- [ ] **Step 3: typecheck で型確認**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(api): add testcontainers postgres harness and admin seed helper"
```

---

## Task 5: DB クエリ（users / apikey 解決）

**Files:**
- Create: `packages/api/src/db/queries.ts`

- [ ] **Step 1: 実装 — `packages/api/src/db/queries.ts`**

```ts
import { apikey, user } from "@picsur/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db";

export interface AuthUser {
  id: string;
  username: string;
}

export async function getUserByUsername(
  db: Db,
  username: string,
): Promise<(AuthUser & { password: string }) | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.username, username))
    .limit(1);
  return row ?? null;
}

export async function getUserById(
  db: Db,
  id: string,
): Promise<AuthUser | null> {
  const [row] = await db
    .select({ id: user.id, username: user.username })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  return row ?? null;
}

// apikey を解決し、対応する user を返す。見つかれば last_used を更新。
export async function resolveApikey(
  db: Db,
  key: string,
): Promise<AuthUser | null> {
  const [row] = await db
    .select({ id: user.id, username: user.username, apikeyId: apikey.id })
    .from(apikey)
    .innerJoin(user, eq(apikey.userId, user.id))
    .where(eq(apikey.key, key))
    .limit(1);
  if (!row) return null;

  await db
    .update(apikey)
    .set({ lastUsed: new Date() })
    .where(eq(apikey.id, row.apikeyId));

  return { id: row.id, username: row.username };
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(api): add user and apikey db queries"
```

---

## Task 6: 認証ミドルウェアと Hono 型

**Files:**
- Create: `packages/api/src/types.ts`
- Create: `packages/api/src/middleware/auth.ts`

- [ ] **Step 1: Hono の Variables 型を定義 — `packages/api/src/types.ts`**

```ts
import type { Db } from "./db";
import type { AuthUser } from "./db/queries";

export interface AppBindings {
  Variables: {
    db: Db;
    user: AuthUser | null;
  };
}
```

- [ ] **Step 2: 認証ミドルウェアを実装 — `packages/api/src/middleware/auth.ts`**

```ts
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { env } from "../env";
import { verifyAuthToken } from "../auth/jwt";
import { getUserById, resolveApikey } from "../db/queries";
import type { AppBindings } from "../types";

export const AUTH_COOKIE = "picsur_jwt";

// JWT cookie か apikey(ヘッダ/クエリ)を解決して c.var.user を埋める。無効なら null。
export const authMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const db = c.var.db;
  let user = null;

  // 1) JWT cookie
  const token = getCookie(c, AUTH_COOKIE);
  if (token) {
    const payload = await verifyAuthToken(token, env.jwtSecret());
    if (payload) user = await getUserById(db, payload.uid);
  }

  // 2) apikey: "Authorization: Api-Key <key>" か "?key=<key>"
  if (!user) {
    const header = c.req.header("Authorization");
    const headerKey = header?.startsWith("Api-Key ")
      ? header.slice("Api-Key ".length)
      : undefined;
    const key = headerKey ?? c.req.query("key");
    if (key) user = await resolveApikey(db, key);
  }

  c.set("user", user);
  await next();
});

// 認証必須ルート用ヘルパ。未認証は 401。
export const requireAuth = createMiddleware<AppBindings>(async (c, next) => {
  if (!c.var.user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add auth middleware (jwt cookie + apikey) and app bindings"
```

---

## Task 7: 認証ルート（login / logout / me）と app への mount

**Files:**
- Create: `packages/api/src/routes/auth.ts`
- Modify: `packages/api/src/app.ts`

- [ ] **Step 1: 認証ルートを実装 — `packages/api/src/routes/auth.ts`**

```ts
import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { env } from "../env";
import { signAuthToken } from "../auth/jwt";
import { verifyPassword } from "../auth/password";
import { getUserByUsername } from "../db/queries";
import { AUTH_COOKIE, requireAuth } from "../middleware/auth";
import type { AppBindings } from "../types";

const MIN_LOGIN_MS = 400;

export const authRoutes = new Hono<AppBindings>();

// ログイン: username/password を検証して JWT cookie をセット
authRoutes.post("/login", async (c) => {
  const start = Date.now();
  const body = await c.req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const row = await getUserByUsername(c.var.db, username);
  const ok = row ? await verifyPassword(password, row.password) : false;

  // タイミング攻撃緩和: 最低 MIN_LOGIN_MS かける
  const wait = MIN_LOGIN_MS - (Date.now() - start);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  if (!row || !ok) {
    return c.json({ error: "invalid credentials" }, 401);
  }

  const token = await signAuthToken(row.id, env.jwtSecret());
  setCookie(c, AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });
  return c.json({ user: { id: row.id, username: row.username } });
});

// ログアウト: cookie 削除
authRoutes.post("/logout", (c) => {
  deleteCookie(c, AUTH_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// 現在のユーザー（要認証）
authRoutes.get("/me", requireAuth, (c) => {
  return c.json({ user: c.var.user });
});
```

- [ ] **Step 2: app.ts を `createApp(db)` ファクトリ化して auth ルートを mount — `packages/api/src/app.ts`**

テストと本番で同じ配線を使えるよう、`db` を引数に取る `createApp` ファクトリにする（テストはテスト db を渡すだけで済み、配線の drift を防ぐ）。既存の `app` export も維持して health テストや server.ts が壊れないようにする。

```ts
import { Hono } from "hono";
import { db, type Db } from "./db";
import { authMiddleware } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import type { AppBindings } from "./types";

export function createApp(database: Db): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  // 全リクエストに db と user を注入
  app.use("*", async (c, next) => {
    c.set("db", database);
    await next();
  });
  app.use("*", authMiddleware);

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);

  return app;
}

// アプリ用シングルトン（server.ts と既存 health テストが使う）
export const app = createApp(db);
```

> `server.ts` は `import { app } from "./app"` のままで動く（`app` は維持）。`db` の re-export 型 `Db` は `./db` から来る。

- [ ] **Step 3: typecheck + 既存 health テストが緑か**

Run: `pnpm --filter @picsur/api typecheck`
Expected: エラー無し。

Run: `pnpm --filter @picsur/api test app`
Expected: 既存の health テストが PASS（app.test.ts は db ミドルウェアが入っても `/api/health` は db 不使用なので通る。もし `c.var.db` 未設定で落ちるなら、health は db を使わないので問題ないはず。落ちる場合は報告）。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add auth routes (login/logout/me) and mount on app"
```

---

## Task 8: 認証の統合テスト（testcontainers）

**Files:**
- Create: `packages/api/src/routes/auth.test.ts`

- [ ] **Step 1: 統合テストを書く — `packages/api/src/routes/auth.test.ts`**

テスト DB を `createApp` に注入してアプリを組む（本番と同じ配線を再利用）。

```ts
import type { Hono } from "hono";
import { afterAll, beforeAll, expect, test } from "vitest";
import { apikey } from "@picsur/shared";
import { createApp } from "../app";
import { hashPassword } from "../auth/password";
import { seedAdmin, startTestDb, type TestDb } from "../test/db";
import type { AppBindings } from "../types";

let tdb: TestDb;
let app: Hono<AppBindings>;

beforeAll(async () => {
  process.env.PICSUR_JWT_SECRET = "test-secret";
  tdb = await startTestDb();

  const hash = await hashPassword("hunter2");
  const adminId = await seedAdmin(tdb.db, "admin", hash);
  // apikey を1つ仕込む
  await tdb.db.insert(apikey).values({
    key: "testkey123",
    userId: adminId,
    name: "test",
  });

  app = createApp(tdb.db);
});

afterAll(async () => {
  await tdb.teardown();
});

test("login with correct credentials sets a cookie and returns user", async () => {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("picsur_jwt=");
  const json = await res.json();
  expect(json.user.username).toBe("admin");
});

test("login with wrong password returns 401", async () => {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  expect(res.status).toBe(401);
});

test("me without auth returns 401", async () => {
  const res = await app.request("/api/auth/me");
  expect(res.status).toBe(401);
});

test("me with apikey query returns the admin user", async () => {
  const res = await app.request("/api/auth/me?key=testkey123");
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.user.username).toBe("admin");
});

test("me with apikey header returns the admin user", async () => {
  const res = await app.request("/api/auth/me", {
    headers: { Authorization: "Api-Key testkey123" },
  });
  expect(res.status).toBe(200);
});

test("me with the login cookie returns the admin user", async () => {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "hunter2" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const res = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.user.username).toBe("admin");
});
```

- [ ] **Step 2: テスト実行（testcontainers が docker で postgres を起動）**

Run: `pnpm --filter @picsur/api test auth`
Expected: 全テスト PASS（login 成功/失敗、me の未認証/apikey クエリ/apikey ヘッダ/cookie）。

> docker daemon が無い環境ではこのテストは起動できない。その場合は BLOCKED ではなく、テストファイルは作成し、テストが docker 必須である旨を報告（DONE_WITH_CONCERNS）。この環境は docker が動く実績あり。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(api): add auth integration tests (login, apikey, cookie) via testcontainers"
```

---

## Task 9: 最終確認

- [ ] **Step 1: api 全テスト + ワークスペース全体の緑確認**

Run: `pnpm --filter @picsur/api test`
Expected: password / jwt / app(health) / auth(統合) 全て PASS。

Run: `pnpm -r build && pnpm -r typecheck`
Expected: shared / api / web 全緑。

> **注意（tsup と native 依存）**: api が `bcrypt`（native）と `pg` を import するようになった。tsup の `noExternal: [/@picsur\/shared/, /^hono/, /@hono\/node-server/]` は bcrypt/pg をバンドルしない（externalize される）。**この時点で api の `pnpm --filter @picsur/api build` が成功しても、runtime（dist/server.js）は bcrypt/pg を node_modules から要求する**ため、Plan 1 の「runtime に node_modules 無し」前提が崩れる。これは想定内で、**Dockerfile の runtime ステージに node_modules を入れる対応は Plan 5（deploy）で行う**。このタスクでは `pnpm -r build`（バンドル生成）が通ることだけ確認し、Docker runtime の node_modules 対応はしない。もし `tsup` ビルド自体が bcrypt の native 解決でエラーになる場合は報告（その場合 bcrypt を `external` に明示する等の対応を検討）。

- [ ] **Step 2: Commit（変更があれば）**

このタスクで新規変更が無ければ commit 不要。

---

## 完了条件

- api が DB 接続（pg + Drizzle）、bcrypt パスワード、hono/jwt cookie 認証、apikey 認証、login/logout/me ルートを持つ
- testcontainers による認証統合テストが緑（docker 前提）
- `pnpm -r build && pnpm -r typecheck` 全緑
- 後続: Plan 3b（画像パイプライン: upload/配信/変換/削除、`/i` を含む全ルートに認証適用）。Docker runtime の native 依存（bcrypt/pg/sharp）の node_modules 対応は Plan 5。
