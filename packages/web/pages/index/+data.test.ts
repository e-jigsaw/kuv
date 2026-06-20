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

test("forwards page from urlParsed and returns the page payload", async () => {
  apiGetMock.mockResolvedValue({
    images: [{ id: "x" }],
    total: 50,
    page: 2,
    pageSize: 24,
  } as never);
  const ctx = {
    headers: { cookie: "kuv_jwt=abc" },
    urlParsed: { search: { page: "2" } },
  } as never;

  const result = await data(ctx);

  expect(result.page).toBe(2);
  expect(result.total).toBe(50);
  expect(result.images).toHaveLength(1);
  expect(apiGetMock).toHaveBeenCalledWith("/api/image/list?page=2", "kuv_jwt=abc");
});

test("defaults to page 1 when no page param", async () => {
  apiGetMock.mockResolvedValue({ images: [], total: 0, page: 1, pageSize: 24 } as never);
  const ctx = { headers: {}, urlParsed: { search: {} } } as never;

  await data(ctx);

  expect(apiGetMock).toHaveBeenCalledWith("/api/image/list?page=1", undefined);
});

test("redirects to /login on Unauthorized", async () => {
  apiGetMock.mockRejectedValue(new UnauthorizedError());
  const ctx = { headers: {}, urlParsed: { search: {} } } as never;

  await expect(data(ctx)).rejects.toThrow("__redirect__:/login");
  expect(redirect).toHaveBeenCalledWith("/login");
});
