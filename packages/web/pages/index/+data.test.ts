import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, apiGet: vi.fn() };
});

import { apiGet, UnauthorizedError } from "../../lib/api";
import { data } from "./+data";

const apiGetMock = vi.mocked(apiGet);

// mockReset は afterEach に置く。beforeEach + 永続 mockRejectedValue の組み合わせは
// vitest 3.2.6 で catch 済みの reject を unhandled rejection として誤検知する。
afterEach(() => apiGetMock.mockReset());

test("returns images and forwards the cookie", async () => {
  apiGetMock.mockResolvedValue({ images: [{ id: "x" }] } as never);
  const ctx = { headers: { cookie: "kuv_jwt=abc" } } as never;

  const result = await data(ctx);

  expect(result.images).toHaveLength(1);
  expect(apiGetMock).toHaveBeenCalledWith("/api/image/list", "kuv_jwt=abc");
});

test("redirects to /login on Unauthorized", async () => {
  apiGetMock.mockRejectedValue(new UnauthorizedError());
  const ctx = { headers: {} } as never;

  await expect(data(ctx)).rejects.not.toBeInstanceOf(UnauthorizedError);
});
