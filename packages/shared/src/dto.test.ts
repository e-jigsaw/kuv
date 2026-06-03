import { expect, test } from "vitest";
import { insertUserSchema, insertApikeySchema } from "./dto";

test("insertUserSchema accepts a valid user payload", () => {
  const parsed = insertUserSchema.safeParse({
    username: "admin",
    password: "hashed",
  });
  expect(parsed.success).toBe(true);
});

test("insertUserSchema rejects a missing username", () => {
  const parsed = insertUserSchema.safeParse({ password: "hashed" });
  expect(parsed.success).toBe(false);
});

test("insertApikeySchema requires userId, key, name", () => {
  const ok = insertApikeySchema.safeParse({
    key: "k",
    userId: "00000000-0000-0000-0000-000000000000",
    name: "sharex",
  });
  expect(ok.success).toBe(true);

  const bad = insertApikeySchema.safeParse({ name: "sharex" });
  expect(bad.success).toBe(false);
});
