import type { Db } from "../db";
import {
  deleteImage,
  findImageById,
  insertImage,
  listImageBlobKeys,
  type ImageMeta,
} from "../db/image-queries";
import { fileKey, type BlobStore } from "./blob-store";
import type { IngestFile } from "./image-ingest";

// アップロードの保存。順序は「S3 put → DB insert」。
// ズレた時の壊れ方を「S3 にだけある（孤児）」側に寄せ、「DB にあるのに実体が無い」は作らない。
export async function saveImage(
  db: Db,
  blob: BlobStore,
  meta: Omit<ImageMeta, "masterFiletype">,
  master: IngestFile,
  original?: IngestFile,
): Promise<void> {
  const putKeys: string[] = [];
  try {
    await blob.put(fileKey(meta.id, "master"), master.data, master.filetype);
    putKeys.push(fileKey(meta.id, "master"));
    if (original) {
      await blob.put(fileKey(meta.id, "original"), original.data, original.filetype);
      putKeys.push(fileKey(meta.id, "original"));
    }
    await insertImage(db, meta, master, original);
  } catch (err) {
    // key は内容由来（id = content hash）なので、同じバイトの並行アップロードが
    // 先に commit していたら、その object を消すと「DB にあるのに実体が無い」になる。
    // 行が存在する（または確認に失敗した）時は片付けをスキップして元のエラーを投げ直す。
    let skipCleanup = false;
    try {
      skipCleanup = (await findImageById(db, meta.id)) !== null;
    } catch (e) {
      skipCleanup = true;
      console.error(`failed to check row before blob cleanup for ${meta.id}`, e);
    }
    if (!skipCleanup) {
      // put 済みの object を best-effort で片付けてから元のエラーを投げ直す
      await blob.delete(putKeys).catch((e) => {
        console.error(`failed to clean up blobs for ${meta.id}`, e);
      });
    }
    throw err;
  }
}

// 削除。順序は「DB delete（cascade）→ S3 best-effort delete」。
// S3 側の失敗はログだけ残して成功扱い（孤児は許容。sweep は後日）。
export async function removeImage(
  db: Db,
  blob: BlobStore,
  id: string,
  userId: string,
): Promise<boolean> {
  const keys = await listImageBlobKeys(db, id);
  const ok = await deleteImage(db, id, userId);
  if (!ok) return false;
  await blob.delete(keys).catch((e) => {
    console.error(`failed to delete blobs for ${id}`, e);
  });
  return true;
}
