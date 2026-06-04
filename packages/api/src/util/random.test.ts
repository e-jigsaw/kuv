import { expect, test } from "vitest";
import { generateRandomString } from "./random";

test("generates a string of the requested length", () => {
  expect(generateRandomString(32)).toHaveLength(32);
  expect(generateRandomString(8)).toHaveLength(8);
});

test("uses only alphanumeric characters", () => {
  expect(generateRandomString(64)).toMatch(/^[A-Za-z0-9]+$/);
});

test("two generations differ", () => {
  expect(generateRandomString(32)).not.toBe(generateRandomString(32));
});
