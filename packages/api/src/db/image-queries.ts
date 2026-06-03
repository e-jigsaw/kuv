import { image, imageFile, settings } from "@picsur/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import type { IngestFile } from "../services/image-ingest";

export interface ImageMeta {
  id: string;
  userId: string;
  fileName: string;
}

export async function findImageById(
  db: Db,
  id: string,
): Promise<ImageMeta | null> {
  const [row] = await db
    .select({ id: image.id, userId: image.userId, fileName: image.fileName })
    .from(image)
    .where(eq(image.id, id))
    .limit(1);
  return row ?? null;
}

// image + image_file(master, +original) を1トランザクションで挿入。
export async function insertImage(
  db: Db,
  meta: ImageMeta,
  master: IngestFile,
  original?: IngestFile,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(image).values({
      id: meta.id,
      userId: meta.userId,
      fileName: meta.fileName,
    });
    await tx.insert(imageFile).values({
      imageId: meta.id,
      variant: "master",
      filetype: master.filetype,
      data: master.data,
    });
    if (original) {
      await tx.insert(imageFile).values({
        imageId: meta.id,
        variant: "original",
        filetype: original.filetype,
        data: original.data,
      });
    }
  });
}

// 所有者一致で削除。消えたら true（FK cascade で image_file/derivative も削除）。
export async function deleteImage(
  db: Db,
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(image)
    .where(and(eq(image.id, id), eq(image.userId, userId)))
    .returning({ id: image.id });
  return deleted.length > 0;
}

export interface Settings {
  keepOriginal: boolean;
}

// settings は単一行（id=1）。行が無ければ keepOriginal=false にフォールバック。
export async function getSettings(db: Db): Promise<Settings> {
  const [row] = await db
    .select({ keepOriginal: settings.keepOriginal })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return { keepOriginal: row?.keepOriginal ?? false };
}
