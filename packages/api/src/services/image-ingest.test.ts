import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "vitest";
import { fixture } from "../test/fixtures";
import { hashBuffer, processImage } from "./image-ingest";

test("hashBuffer is the sha256 hex of the input", async () => {
  const buf = await fixture("red.png");
  const expected = createHash("sha256").update(buf).digest("hex");
  expect(hashBuffer(buf)).toBe(expected);
});

test("processImage returns id, master with same mime, no original by default", async () => {
  const buf = await fixture("red.png");
  const r = await processImage(buf, false);
  expect(r).not.toBe(null);
  expect(r!.id).toBe(hashBuffer(buf));
  expect(r!.master.filetype).toBe("image/png");
  expect(r!.original).toBeUndefined();
  // master は valid な png
  const meta = await sharp(r!.master.data).metadata();
  expect(meta.format).toBe("png");
});

test("processImage strips exif from the master", async () => {
  const buf = await fixture("exif.jpg");
  // 入力には exif がある
  const inMeta = await sharp(buf).metadata();
  expect(inMeta.exif).toBeDefined();
  // master には無い
  const r = await processImage(buf, false);
  const outMeta = await sharp(r!.master.data).metadata();
  expect(outMeta.exif).toBeUndefined();
});

test("processImage keeps animation frames in the master", async () => {
  const buf = await fixture("anim.webp");
  const r = await processImage(buf, false);
  const meta = await sharp(r!.master.data, { animated: true }).metadata();
  expect(meta.pages).toBe(2);
});

test("processImage keeps animation frames in a gif master", async () => {
  const buf = await fixture("anim.gif");
  const r = await processImage(buf, false);
  const meta = await sharp(r!.master.data, { animated: true }).metadata();
  expect(meta.pages).toBe(2);
});

test("processImage keeps the original (verbatim) when keepOriginal is true", async () => {
  const buf = await fixture("red.png");
  const r = await processImage(buf, true);
  expect(r!.original).toBeDefined();
  expect(r!.original!.filetype).toBe("image/png");
  expect(Buffer.compare(r!.original!.data, buf)).toBe(0);
});

test("processImage returns null for an unsupported buffer", async () => {
  const r = await processImage(await fixture("notimage.txt"), false);
  expect(r).toBe(null);
});
