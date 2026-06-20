import { MIME_TO_EXT, PAGE_SIZE, type SupportedMime } from "@kuv/shared";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import {
  deleteImage,
  findImageById,
  findImageForUser,
  getSettings,
  insertImage,
  listImages,
} from "../db/image-queries";
import { hashBuffer, processImage } from "../services/image-ingest";
import type { AppBindings } from "../types";

export const imageRoutes = new Hono<AppBindings>();

function links(id: string, mime: string) {
  const ext = MIME_TO_EXT[mime as SupportedMime] ?? "bin";
  return { view: `/i/${id}`, direct: `/i/${id}.${ext}` };
}

// 自分の画像一覧（要認証）。created desc・ページ番号 + オフセット。
// page は 1 始まり、不正値・未指定は 1 に丸める。
imageRoutes.get("/list", requireAuth, async (c) => {
  const parsed = Number.parseInt(c.req.query("page") ?? "", 10);
  const page = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const { rows, total } = await listImages(c.var.db, c.var.user!.id, {
    limit: PAGE_SIZE,
    offset,
  });
  return c.json({
    images: rows.map((r) => ({
      id: r.id,
      file_name: r.fileName,
      created: r.created,
      master_filetype: r.masterFiletype,
      links: links(r.id, r.masterFiletype),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
});

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

// アップロード（要認証）。multipart の "file" フィールドを受け取る。
// 自家用・単一ユーザー前提のため bodyLimit は意図的に未設定
imageRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "no file" }, 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());

  // dedupe: 既存 id なら再処理せず既存を返す。
  // 注: owner は見ない（単一 admin 前提。マルチユーザー化するなら要 owner チェック）
  const id = hashBuffer(buf);
  const existing = await findImageById(c.var.db, id);
  if (existing) {
    return c.json({
      id: existing.id,
      file_name: existing.fileName,
      links: links(id, existing.masterFiletype),
    });
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
// c.var.user.id は DB 由来の UUID（deleteImage は非 UUID を渡すと pg エラーを投げる契約）
imageRoutes.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const ok = await deleteImage(c.var.db, id, c.var.user!.id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
