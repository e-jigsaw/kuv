import { createHash } from "node:crypto";
import type { SupportedMime } from "@kuv/shared";
import sharp from "sharp";
import { OUTPUT_FORMAT } from "./image-ingest";

// derivative の cache key（設計: key = sha256(対象mime)）
export function derivativeKey(targetMime: SupportedMime): string {
  return createHash("sha256").update(targetMime).digest("hex");
}

// master buffer を対象形式に変換する（形式変換のみ、編集無し）。
// アニメ対応形式（webp/gif）へは {animated:true} でフレーム保持、png/jpeg へは 1 フレーム目に潰れる。
export async function convertImage(
  buf: Buffer,
  targetMime: SupportedMime,
): Promise<Buffer> {
  const animatedOut =
    targetMime === "image/webp" || targetMime === "image/gif";
  let pipeline = sharp(buf, { animated: animatedOut });
  // jpeg はアルファ非対応。sharp デフォルトの黒合成ではなく白背景に flatten する
  if (targetMime === "image/jpeg") {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
  }
  return pipeline.toFormat(OUTPUT_FORMAT[targetMime]).toBuffer();
}
