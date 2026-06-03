import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { signAuthToken } from "../auth/jwt";
import { verifyPassword } from "../auth/password";
import { getUserByUsername } from "../db/queries";
import { env } from "../env";
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
