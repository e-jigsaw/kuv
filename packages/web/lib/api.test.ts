import { afterEach, expect, test, vi } from "vitest";
import { apiDelete, apiGet, apiPost, apiPut, UnauthorizedError, uploadImage } from "./api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  // SSR テストが unstubAllGlobals() するので fetch スタブを貼り直す。
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("apiGet returns parsed json", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  const r = await apiGet<{ ok: boolean }>("/api/health");
  expect(r).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledWith("/api/health", undefined);
});

test("401 throws UnauthorizedError", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
  await expect(apiGet("/api/auth/me")).rejects.toBeInstanceOf(UnauthorizedError);
});

test("non-ok throws Error with server message", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ error: "unsupported file type" }, 415));
  await expect(apiGet("/api/image")).rejects.toThrow("unsupported file type");
});

test("apiPost sends json body", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  await apiPost("/api/auth/login", { username: "a", password: "b" });
  const [, init] = fetchMock.mock.calls[0]!;
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ "content-type": "application/json" });
  expect(JSON.parse(init.body)).toEqual({ username: "a", password: "b" });
});

test("apiPost without body sends no content-type", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  await apiPost("/api/auth/logout");
  const [, init] = fetchMock.mock.calls[0]!;
  expect(init.method).toBe("POST");
  expect(init.headers).toBeUndefined();
  expect(init.body).toBeUndefined();
});

test("apiPut and apiDelete use the right methods", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
  await apiPut("/api/settings", { keep_original: true });
  expect(fetchMock.mock.calls[0]![1].method).toBe("PUT");
  await apiDelete("/api/apikey/x");
  expect(fetchMock.mock.calls[1]![1].method).toBe("DELETE");
});

test("uploadImage posts multipart form data", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ id: "abc", file_name: "a.png", links: { view: "/i/abc", direct: "/i/abc.png" } }),
  );
  const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
  const r = await uploadImage(file);
  expect(r.id).toBe("abc");
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/image");
  expect(init.method).toBe("POST");
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get("file")).toBe(file);
});

test("SSR resolves an absolute base and forwards the cookie", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubEnv("KUV_API_BASE", "http://api:3001");
  fetchMock.mockResolvedValue(jsonResponse({ images: [] }));

  await apiGet("/api/image/list", "kuv_jwt=abc");

  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("http://api:3001/api/image/list");
  expect(new Headers(init.headers).get("cookie")).toBe("kuv_jwt=abc");

  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("SSR falls back to http://api:3001 when KUV_API_BASE is unset", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubEnv("KUV_API_BASE", "");
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

  await apiGet("/api/settings");

  expect(fetchMock.mock.calls[0]![0]).toBe("http://api:3001/api/settings");

  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
