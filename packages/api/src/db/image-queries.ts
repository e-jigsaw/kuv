import { image, imageDerivative, imageFile, settings } from "@picsur/shared";
import type { ImageVariant } from "@picsur/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import type { IngestFile } from "../services/image-ingest";

export interface ImageMeta {
  id: string;
  userId: string;
  fileName: string;
  masterFiletype: string;
}

export async function findImageById(
  db: Db,
  id: string,
): Promise<ImageMeta | null> {
  const [row] = await db
    .select({
      id: image.id,
      userId: image.userId,
      fileName: image.fileName,
      masterFiletype: imageFile.filetype,
    })
    .from(image)
    .innerJoin(
      imageFile,
      and(eq(imageFile.imageId, image.id), eq(imageFile.variant, "master")),
    )
    .where(eq(image.id, id))
    .limit(1);
  return row ?? null;
}

// image + image_file(master, +original) を1トランザクションで挿入。
// 前提: 呼び出し前に findImageById で存在確認済みであること。同一 id の二重 insert は PK 違反で throw する。
export async function insertImage(
  db: Db,
  meta: Omit<ImageMeta, "masterFiletype">,
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
// userId は UUID 文字列であること。non-UUID を渡すと pg が uuid パースエラーを throw する。
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

export interface StoredFile {
  filetype: string;
  data: Buffer;
}

// variant ('master' | 'original') の実バイトを取得。
export async function getImageFile(
  db: Db,
  imageId: string,
  variant: ImageVariant,
): Promise<StoredFile | null> {
  const [row] = await db
    .select({ filetype: imageFile.filetype, data: imageFile.data })
    .from(imageFile)
    .where(
      and(eq(imageFile.imageId, imageId), eq(imageFile.variant, variant)),
    )
    .limit(1);
  return row ?? null;
}

// derivative を取得。hit なら last_read を更新する。
export async function getDerivative(
  db: Db,
  imageId: string,
  key: string,
): Promise<StoredFile | null> {
  const [row] = await db
    .select({
      id: imageDerivative.id,
      filetype: imageDerivative.filetype,
      data: imageDerivative.data,
    })
    .from(imageDerivative)
    .where(
      and(eq(imageDerivative.imageId, imageId), eq(imageDerivative.key, key)),
    )
    .limit(1);
  if (!row) return null;

  await db
    .update(imageDerivative)
    .set({ lastRead: new Date() })
    .where(eq(imageDerivative.id, row.id));

  return { filetype: row.filetype, data: row.data };
}

// derivative を保存。並行生成で unique(image_id, key) に衝突したら先勝ちで無視。
// 注: DB エラー時は必ず reject すること（mutexFallBack の fallback として使われるため、
// 「書けていないのに resolve」すると待ち側の cache lookup 再試行が無限ループする）。
export async function insertDerivative(
  db: Db,
  imageId: string,
  key: string,
  filetype: string,
  data: Buffer,
): Promise<void> {
  await db
    .insert(imageDerivative)
    .values({ imageId, key, filetype, data })
    .onConflictDoNothing();
}
