import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, apiGet: vi.fn() };
});

vi.mock("vike/abort", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__redirect__:${url}`);
  }),
}));

import { redirect } from "vike/abort";
import { apiGet, UnauthorizedError } from "../../lib/api";
import { data } from "./+data";

const apiGetMock = vi.mocked(apiGet);

// mockReset は afterEach に置く。beforeEach + 永続 mockRejectedValue の組み合わせは
// vitest 3.2.6 で catch 済みの reject を unhandled rejection として誤検知する。
afterEach(() => {
  apiGetMock.mockReset();
  vi.mocked(redirect).mockClear();
});

test("returns settings and apikeys with the cookie", async () => {
  apiGetMock
    .mockResolvedValueOnce({ keep_original: true } as never)
    .mockResolvedValueOnce({ apikeys: [{ id: "k1" }] } as never);
  const ctx = { headers: { cookie: "kuv_jwt=abc" } } as never;

  const result = await data(ctx);

  expect(result.settings.keep_original).toBe(true);
  expect(result.apikeys).toHaveLength(1);
  expect(apiGetMock).toHaveBeenCalledWith("/api/settings", "kuv_jwt=abc");
  expect(apiGetMock).toHaveBeenCalledWith("/api/apikey", "kuv_jwt=abc");
});

test("redirects to /login on Unauthorized", async () => {
  apiGetMock.mockRejectedValue(new UnauthorizedError());
  const ctx = { headers: {} } as never;

  await expect(data(ctx)).rejects.toThrow("__redirect__:/login");
  expect(redirect).toHaveBeenCalledWith("/login");
});
