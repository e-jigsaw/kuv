import { expect, test } from "vitest";
import { IMAGE_VARIANTS, SUPPORTED_MIMES, isSupportedMime } from "./constants";

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
