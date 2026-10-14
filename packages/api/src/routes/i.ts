import { EXT_TO_MIME, type ImageVariant, type SupportedMime } from "@kuv/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  getDerivative,
  getImageFile,
  insertDerivative,
} from "../db/image-queries";
import { derivativeBlobKey, fileKey } from "../services/blob-store";
import { convertImage, derivativeKey } from "../services/image-convert";
import { mutexFallBack } from "../util/mutex-fallback";
import { requireAuth } from "../middleware/auth";
import type { AppBindings } from "../types";

export const iRoutes = new Hono<AppBindings>();

interface LoadedFile {
  filetype: string;
  data: Buffer;
}

function serve(c: Context<AppBindings>, filetype: string, data: Buffer) {
  c.header("Content-Type", filetype);
  // id は content-hash なので内容は不変。認証必須なので private。
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  // 埋め込み用（設計どおり）
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  return c.body(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
}

// メタは DB、実バイトは BlobStore から。DB に行があって object が無いのは不整合なので 404 + ログ
async function loadFile(
  c: Context<AppBindings>,
  id: string,
  variant: ImageVariant,
): Promise<LoadedFile | null> {
  const meta = await getImageFile(c.var.db, id, variant);
  if (!meta) return null;
  const key = fileKey(id, variant);
  const data = await c.var.blob.get(key);
  if (!data) {
    console.error(`blob missing for existing row: ${key}`);
    return null;
  }
  return { filetype: meta.filetype, data };
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

  // ?variant=original → 保存された元バイト列をそのまま返す。
  // 無ければ 404（master にはフォールバックしない）。ext は同形式のみ許可し、変換はしない。
  const variant = c.req.query("variant");
  if (variant !== undefined) {
    if (variant !== "original") return c.json({ error: "invalid variant" }, 400);
    const original = await loadFile(c, id, "original");
    if (!original) return c.json({ error: "not found" }, 404);
    if (targetMime && targetMime !== original.filetype) {
      return c.json({ error: "not found" }, 404);
    }
    return serve(c, original.filetype, original.data);
  }

  const master = await loadFile(c, id, "master");
  if (!master) return c.json({ error: "not found" }, 404);

  // ext 無し、または master と同形式 → master をそのまま返す
  if (!targetMime || targetMime === master.filetype) {
    return serve(c, master.filetype, master.data);
  }

  // 別形式 → derivative キャッシュ。miss（DB 行 or object が無い）は mutex 内で変換して保存
  const key = derivativeKey(targetMime);
  const blobKey = derivativeBlobKey(id, key);
  const derivative = await mutexFallBack(
    `${id}:${targetMime}`,
    async () => {
      const meta = await getDerivative(c.var.db, id, key);
      if (!meta) return null;
      const data = await c.var.blob.get(blobKey);
      return data ? { filetype: meta.filetype, data } : null;
    },
    async () => {
      const data = await convertImage(master.data, targetMime);
      await c.var.blob.put(blobKey, data, targetMime);
      await insertDerivative(c.var.db, id, key, targetMime);
      return { filetype: targetMime, data };
    },
  );
  return serve(c, derivative.filetype, derivative.data);
});
