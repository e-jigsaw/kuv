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
