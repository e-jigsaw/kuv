import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { verifyAuthToken } from "../auth/jwt";
import { getUserById, resolveApikey } from "../db/queries";
import { env } from "../env";
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
