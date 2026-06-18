import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../../lib/api")>();
  return { ...actual, apiGet: vi.fn() };
});

import { apiGet, UnauthorizedError } from "../../../lib/api";
import { data } from "./+data";

const apiGetMock = vi.mocked(apiGet);

// mockReset は afterEach に置く。beforeEach + 永続 mockRejectedValue の組み合わせは
// vitest 3.2.6 で catch 済みの reject を unhandled rejection として誤検知する。
afterEach(() => apiGetMock.mockReset());

test("returns the image meta for the route id with the cookie", async () => {
  apiGetMock.mockResolvedValue({ id: "img1", file_name: "cat.png" } as never);
  const ctx = {
    headers: { cookie: "kuv_jwt=abc" },
    routeParams: { id: "img1" },
  } as never;

  const result = await data(ctx);

  expect(result.image.id).toBe("img1");
  expect(apiGetMock).toHaveBeenCalledWith("/api/image/img1", "kuv_jwt=abc");
});

test("redirects to /login on Unauthorized", async () => {
  apiGetMock.mockRejectedValue(new UnauthorizedError());
  const ctx = { headers: {}, routeParams: { id: "img1" } } as never;

  await expect(data(ctx)).rejects.not.toBeInstanceOf(UnauthorizedError);
});
