import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "vitest";
import { fixture } from "../test/fixtures";
import { convertImage, derivativeKey } from "./image-convert";

test("derivativeKey is the sha256 hex of the target mime", () => {
  const expected = createHash("sha256").update("image/webp").digest("hex");
  expect(derivativeKey("image/webp")).toBe(expected);
});

test("converts a png to a valid webp", async () => {
  const buf = await fixture("red.png");
  const out = await convertImage(buf, "image/webp");
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("webp");
});

test("keeps animation frames when converting animated webp to gif", async () => {
  const buf = await fixture("anim.webp");
  const out = await convertImage(buf, "image/gif");
  const meta = await sharp(out, { animated: true }).metadata();
  expect(meta.format).toBe("gif");
  expect(meta.pages).toBe(2);
});

test("flattens an animated gif to a still png (first frame)", async () => {
  const buf = await fixture("anim.gif");
  const out = await convertImage(buf, "image/png");
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("png");
  // 静止画になっている（pages 無し or 1）
  expect(meta.pages ?? 1).toBe(1);
});
