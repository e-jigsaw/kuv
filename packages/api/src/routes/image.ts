import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import {
  deleteImage,
  findImageById,
  getSettings,
  insertImage,
} from "../db/image-queries";
import { hashBuffer, processImage } from "../services/image-ingest";
import type { AppBindings } from "../types";

export const imageRoutes = new Hono<AppBindings>();

// mime → 配信用拡張子
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function links(id: string, mime: string) {
  const ext = EXT[mime] ?? "bin";
  return { view: `/i/${id}`, direct: `/i/${id}.${ext}` };
}

// アップロード（要認証）。multipart の "file" フィールドを受け取る。
// 自家用・単一ユーザー前提のため bodyLimit は意図的に未設定
imageRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "no file" }, 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());

  // dedupe: 既存 id なら再処理せず既存を返す
  const id = hashBuffer(buf);
  const existing = await findImageById(c.var.db, id);
  if (existing) {
    // master の filetype を引いて links を返す
    return c.json({ id: existing.id, file_name: existing.fileName, links: links(id, "image/png") });
  }

  const user = c.var.user!;
  const settings = await getSettings(c.var.db);
  const result = await processImage(buf, settings.keepOriginal);
  if (!result) {
    return c.json({ error: "unsupported file type" }, 415);
  }

  const fileName = file.name || "image";
  await insertImage(
    c.var.db,
    { id: result.id, userId: user.id, fileName },
    result.master,
    result.original,
  );

  return c.json({
    id: result.id,
    file_name: fileName,
    links: links(result.id, result.master.filetype),
  });
});

// 削除（要認証）。所有者一致のみ。
imageRoutes.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ok = await deleteImage(c.var.db, id, c.var.user!.id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
