import { expect, test } from "vitest";
import { IMAGE_VARIANTS, SUPPORTED_MIMES, isSupportedMime, MIME_TO_EXT, EXT_TO_MIME } from "./constants";

test("IMAGE_VARIANTS lists master and original", () => {
  expect(IMAGE_VARIANTS).toEqual(["master", "original"]);
});

test("SUPPORTED_MIMES covers png/jpeg/webp/gif", () => {
  expect(SUPPORTED_MIMES).toEqual([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);
});

test("isSupportedMime accepts supported and rejects others", () => {
  expect(isSupportedMime("image/png")).toBe(true);
  expect(isSupportedMime("image/tiff")).toBe(false);
  expect(isSupportedMime("application/json")).toBe(false);
});

test("MIME_TO_EXT covers all supported mimes", () => {
  expect(MIME_TO_EXT).toEqual({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  });
});

test("EXT_TO_MIME maps serving extensions including jpeg alias", () => {
  expect(EXT_TO_MIME).toEqual({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  });
});

test("MIME_TO_EXT and EXT_TO_MIME round-trip for every supported mime", () => {
  for (const mime of SUPPORTED_MIMES) {
    expect(EXT_TO_MIME[MIME_TO_EXT[mime]]).toBe(mime);
  }
});
