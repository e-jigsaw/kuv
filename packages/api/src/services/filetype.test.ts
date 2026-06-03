import { expect, test } from "vitest";
import { fixture } from "../test/fixtures";
import { detectImageType } from "./filetype";

test("detects a still png as image/png, not animated", async () => {
  const r = await detectImageType(await fixture("red.png"));
  expect(r).toEqual({ mime: "image/png", animated: false });
});

test("detects a jpeg", async () => {
  const r = await detectImageType(await fixture("exif.jpg"));
  expect(r).toEqual({ mime: "image/jpeg", animated: false });
});

test("detects an animated webp", async () => {
  const r = await detectImageType(await fixture("anim.webp"));
  expect(r).toEqual({ mime: "image/webp", animated: true });
});

test("detects an animated gif", async () => {
  const r = await detectImageType(await fixture("anim.gif"));
  expect(r).toEqual({ mime: "image/gif", animated: true });
});

test("returns null for an unsupported (non-image) buffer", async () => {
  const r = await detectImageType(await fixture("notimage.txt"));
  expect(r).toBe(null);
});

test("returns null for a corrupt buffer that has PNG magic bytes but invalid body", async () => {
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const corrupt = Buffer.concat([pngMagic, Buffer.from("garbage-not-a-real-png-body")]);
  const r = await detectImageType(corrupt);
  expect(r).toBe(null);
});

test("detects a still webp as image/webp, not animated", async () => {
  const r = await detectImageType(await fixture("still.webp"));
  expect(r).toEqual({ mime: "image/webp", animated: false });
});
