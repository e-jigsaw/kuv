import { expect, test } from "vitest";
import { app } from "./app";

test("GET /api/health returns ok", async () => {
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
