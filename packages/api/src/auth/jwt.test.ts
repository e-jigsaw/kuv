import { expect, test } from "vitest";
import { signAuthToken, verifyAuthToken } from "./jwt";

const SECRET = "test-secret";

test("signAuthToken then verifyAuthToken round-trips the uid", async () => {
  const token = await signAuthToken("user-123", SECRET);
  const payload = await verifyAuthToken(token, SECRET);
  expect(payload?.uid).toBe("user-123");
});

test("verifyAuthToken returns null for a bad token", async () => {
  expect(await verifyAuthToken("garbage", SECRET)).toBe(null);
});

test("verifyAuthToken returns null for a wrong secret", async () => {
  const token = await signAuthToken("user-123", SECRET);
  expect(await verifyAuthToken(token, "other-secret")).toBe(null);
});
