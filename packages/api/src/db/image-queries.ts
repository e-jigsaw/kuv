import { image, imageDerivative, imageFile, settings } from "@kuv/shared";
import type { ImageVariant } from "@kuv/shared";
import { and, count, desc, eq } from "drizzle-orm";
import type { Db } from "../db";
import { derivativeBlobKey, fileKey } from "../services/blob-store";

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
// 実バイトは BlobStore 側（呼び出し側で put 済み）。ここではメタ行だけ書く。
// 前提: 呼び出し前に findImageById で存在確認済みであること。同一 id の二重 insert は PK 違反で throw する。
export async function insertImage(
  db: Db,
  meta: Omit<ImageMeta, "masterFiletype">,
  master: FileMeta,
  original?: FileMeta,
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
    });
    if (original) {
      await tx.insert(imageFile).values({
        imageId: meta.id,
        variant: "original",
        filetype: original.filetype,
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

// image_file / image_derivative のメタ。実バイトは BlobStore にある
export interface FileMeta {
  filetype: string;
}

// variant ('master' | 'original') のメタを取得。
export async function getImageFile(
  db: Db,
  imageId: string,
  variant: ImageVariant,
): Promise<FileMeta | null> {
  const [row] = await db
    .select({ filetype: imageFile.filetype })
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
): Promise<FileMeta | null> {
  const [row] = await db
    .select({
      id: imageDerivative.id,
      filetype: imageDerivative.filetype,
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

  return { filetype: row.filetype };
}

export interface ImageListEntry {
  id: string;
  fileName: string;
  created: Date;
  masterFiletype: string;
}

export interface ListImagesResult {
  rows: ImageListEntry[];
  total: number;
}

// 自分の画像一覧（created desc）。limit/offset でページングし、総件数も返す。
// rows と count は別クエリ（offset が total を超える空ページでも total を取るため）。
export async function listImages(
  db: Db,
  userId: string,
  opts: { limit: number; offset: number },
): Promise<ListImagesResult> {
  const rows = await db
    .select({
      id: image.id,
      fileName: image.fileName,
      created: image.created,
      masterFiletype: imageFile.filetype,
    })
    .from(image)
    .innerJoin(
      imageFile,
      and(eq(imageFile.imageId, image.id), eq(imageFile.variant, "master")),
    )
    .where(eq(image.userId, userId))
    .orderBy(desc(image.created))
    .limit(opts.limit)
    .offset(opts.offset);

  const [totalRow] = await db
    .select({ total: count() })
    .from(image)
    .where(eq(image.userId, userId));

  return { rows, total: totalRow?.total ?? 0 };
}

// 個別画像メタ（所有者一致）。SSR の +data 用に1件取得。
export async function findImageForUser(
  db: Db,
  id: string,
  userId: string,
): Promise<ImageListEntry | null> {
  const [row] = await db
    .select({
      id: image.id,
      fileName: image.fileName,
      created: image.created,
      masterFiletype: imageFile.filetype,
    })
    .from(image)
    .innerJoin(
      imageFile,
      and(eq(imageFile.imageId, image.id), eq(imageFile.variant, "master")),
    )
    .where(and(eq(image.id, id), eq(image.userId, userId)))
    .limit(1);
  return row ?? null;
}

// settings 単一行（id=1）を upsert
export async function updateSettings(db: Db, s: Settings): Promise<void> {
  await db
    .insert(settings)
    .values({ id: 1, keepOriginal: s.keepOriginal })
    .onConflictDoUpdate({
      target: settings.id,
      set: { keepOriginal: s.keepOriginal },
    });
}

// derivative を保存。並行生成で unique(image_id, key) に衝突したら先勝ちで無視。
// 注: DB エラー時は必ず reject すること（mutexFallBack の fallback として使われるため、
// 「書けていないのに resolve」すると待ち側の cache lookup 再試行が無限ループする）。
export async function insertDerivative(
  db: Db,
  imageId: string,
  key: string,
  filetype: string,
): Promise<void> {
  await db
    .insert(imageDerivative)
    .values({ imageId, key, filetype })
    .onConflictDoNothing();
}

// 画像に紐づく object key を全部返す（削除時に BlobStore から消すため）
export async function listImageBlobKeys(db: Db, imageId: string): Promise<string[]> {
  const files = await db
    .select({ variant: imageFile.variant })
    .from(imageFile)
    .where(eq(imageFile.imageId, imageId));
  const derivs = await db
    .select({ key: imageDerivative.key })
    .from(imageDerivative)
    .where(eq(imageDerivative.imageId, imageId));
  return [
    ...files.map((f) => fileKey(imageId, f.variant as ImageVariant)),
    ...derivs.map((d) => derivativeBlobKey(imageId, d.key)),
  ];
}
