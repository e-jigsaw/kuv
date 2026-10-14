import { expect, test } from "vitest";
import { createApp } from "./app";
import { db } from "./db";
import { createMemoryBlobStore } from "./services/blob-store";

test("GET /api/health returns ok", async () => {
  const app = createApp(db, createMemoryBlobStore());
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
