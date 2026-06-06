import { expect, test } from "vitest";
import { KUV_VERSION } from "./index";

test("exposes the app version", () => {
  expect(KUV_VERSION).toBe("0.6.0");
});
