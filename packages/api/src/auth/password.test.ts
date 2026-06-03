import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("hashPassword produces a verifiable hash", async () => {
  const hash = await hashPassword("correct horse");
  expect(hash).not.toBe("correct horse");
  expect(await verifyPassword("correct horse", hash)).toBe(true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("correct horse");
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
