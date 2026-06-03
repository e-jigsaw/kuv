import { isSupportedMime, type SupportedMime } from "@picsur/shared";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export interface DetectedType {
  mime: SupportedMime;
  animated: boolean;
}

// buffer の実バイトから mime を判定し、対応形式なら DetectedType、それ以外は null。
export async function detectImageType(
  buf: Buffer,
): Promise<DetectedType | null> {
  const ft = await fileTypeFromBuffer(buf);
  if (!ft || !isSupportedMime(ft.mime)) return null;

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(buf, { animated: true }).metadata();
  } catch {
    // magic bytes が一致しても本体が壊れている場合は null を返す（呼び出し側が 415 にマップ）
    return null;
  }

  // sharp は静止画で pages を返さないため、未定義時は 1 ページとして扱う
  const animated = (meta.pages ?? 1) > 1;
  return { mime: ft.mime, animated };
}
