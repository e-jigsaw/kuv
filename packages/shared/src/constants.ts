export const IMAGE_VARIANTS = ["master", "original"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

export const SUPPORTED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type SupportedMime = (typeof SUPPORTED_MIMES)[number];

export function isSupportedMime(mime: string): mime is SupportedMime {
  return (SUPPORTED_MIMES as readonly string[]).includes(mime);
}

// 配信用拡張子マップ（routes/image の links と routes/i の ext 解決が共用）
export const MIME_TO_EXT: Record<SupportedMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const EXT_TO_MIME: Record<string, SupportedMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// 画像一覧 1 ページの件数（api route と web が共用）
export const PAGE_SIZE = 24;
