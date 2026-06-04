import { EXT_TO_MIME, type SupportedMime } from "@picsur/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  getDerivative,
  getImageFile,
  insertDerivative,
} from "../db/image-queries";
import { convertImage, derivativeKey } from "../services/image-convert";
import { mutexFallBack } from "../util/mutex-fallback";
import { requireAuth } from "../middleware/auth";
import type { AppBindings } from "../types";

export const iRoutes = new Hono<AppBindings>();

function serve(c: Context<AppBindings>, filetype: string, data: Buffer) {
  c.header("Content-Type", filetype);
  // id は content-hash なので内容は不変。認証必須なので private。
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  // 埋め込み用（設計どおり）
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  return c.body(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
}

// GET /i/:id または /i/:id.:ext（要認証 — 画像も完全プライベート）
iRoutes.get("/:idWithExt", requireAuth, async (c) => {
  const idWithExt = c.req.param("idWithExt");
  const dot = idWithExt.indexOf(".");
  const id = dot === -1 ? idWithExt : idWithExt.slice(0, dot);
  const ext = dot === -1 ? null : idWithExt.slice(dot + 1).toLowerCase();
  if (!id) return c.json({ error: "not found" }, 404);

  const targetMime = ext === null ? null : EXT_TO_MIME[ext];
  if (ext !== null && targetMime === undefined) {
    return c.json({ error: "not found" }, 404);
  }

  const master = await getImageFile(c.var.db, id, "master");
  if (!master) return c.json({ error: "not found" }, 404);

  // ext 無し、または master と同形式 → master をそのまま返す
  if (!targetMime || targetMime === master.filetype) {
    return serve(c, master.filetype, master.data);
  }

  // 別形式 → derivative キャッシュ。miss は mutex 内で変換して保存
  const key = derivativeKey(targetMime);
  const derivative = await mutexFallBack(
    `${id}:${targetMime}`,
    () => getDerivative(c.var.db, id, key),
    async () => {
      const data = await convertImage(master.data, targetMime);
      await insertDerivative(c.var.db, id, key, targetMime, data);
      return { filetype: targetMime, data };
    },
  );
  return serve(c, derivative.filetype, derivative.data);
});
