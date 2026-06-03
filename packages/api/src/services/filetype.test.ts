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
