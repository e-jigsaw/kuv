import { expect, test } from "vitest";
import { PICSUR_VERSION } from "./index";

test("exposes the app version", () => {
  expect(PICSUR_VERSION).toBe("0.6.0");
});
