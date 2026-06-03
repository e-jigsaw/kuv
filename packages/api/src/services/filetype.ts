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

  const meta = await sharp(buf, { animated: true }).metadata();
  const animated = (meta.pages ?? 1) > 1;
  return { mime: ft.mime, animated };
}
