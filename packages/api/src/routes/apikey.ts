import { Hono } from "hono";
import {
  createApikey,
  deleteApikey,
  listApikeys,
  type ApikeyEntry,
} from "../db/apikey-queries";
import { requireAuth } from "../middleware/auth";
import { generateRandomString } from "../util/random";
import type { AppBindings } from "../types";

// ApikeyEntry → API レスポンス（他ルートと同じ snake_case に揃える）
function toJson(e: ApikeyEntry) {
  return {
    id: e.id,
    name: e.name,
    key: e.key,
    created: e.created,
    last_used: e.lastUsed,
  };
}

export const apikeyRoutes = new Hono<AppBindings>();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 一覧（要認証）。key は平文保存方式（旧実装踏襲・既存キー互換）なので再表示する
apikeyRoutes.get("/", requireAuth, async (c) => {
  const apikeys = await listApikeys(c.var.db, c.var.user!.id);
  return c.json({ apikeys: apikeys.map(toJson) });
});

// 発行（要認証）。name 省略時は旧実装と同じ YYYY-MM-DD_<n>
apikeyRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name =
    typeof body?.name === "string" && body.name !== ""
      ? body.name
      : `${new Date().toISOString().slice(0, 10)}_${Math.round(Math.random() * 100)}`;
  const key = generateRandomString(32);
  const apikey = await createApikey(c.var.db, c.var.user!.id, name, key);
  return c.json({ apikey: toJson(apikey) });
});

// 失効（要認証）。所有者一致のみ。non-uuid は pg エラーを避けて即 404
apikeyRoutes.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const ok = await deleteApikey(c.var.db, id, c.var.user!.id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
