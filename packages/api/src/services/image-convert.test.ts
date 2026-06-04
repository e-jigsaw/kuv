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

test("flattens transparency onto white when converting to jpeg", async () => {
  // 半透明の赤 8x8 png
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const out = await convertImage(buf, "image/jpeg");
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("jpeg");
  // 完全透過の領域は白く flatten される（黒 0,0,0 ではなく 255 近傍）
  const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  expect(data[0]).toBeGreaterThan(200); // R
  expect(data[1]).toBeGreaterThan(200); // G
  expect(data[2]).toBeGreaterThan(200); // B
});

test("flattens an animated gif to a still jpeg (first frame)", async () => {
  const buf = await fixture("anim.gif");
  const out = await convertImage(buf, "image/jpeg");
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("jpeg");
  expect(meta.pages ?? 1).toBe(1);
});
