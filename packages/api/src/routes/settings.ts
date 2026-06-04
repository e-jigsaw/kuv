import { Hono } from "hono";
import { getSettings, updateSettings } from "../db/image-queries";
import { requireAuth } from "../middleware/auth";
import type { AppBindings } from "../types";

export const settingsRoutes = new Hono<AppBindings>();

// 設定取得（要認証）
settingsRoutes.get("/", requireAuth, async (c) => {
  const s = await getSettings(c.var.db);
  return c.json({ keep_original: s.keepOriginal });
});

// 設定更新（要認証）。単一行 upsert
settingsRoutes.put("/", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.keep_original !== "boolean") {
    return c.json({ error: "keep_original must be boolean" }, 400);
  }
  await updateSettings(c.var.db, { keepOriginal: body.keep_original });
  return c.json({ keep_original: body.keep_original });
});
