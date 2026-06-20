// api レスポンス型（api 側は snake_case で統一されている）
export interface ImageLinks {
  view: string;
  direct: string;
}

export interface ImageEntry {
  id: string;
  file_name: string;
  created: string;
  master_filetype: string;
  links: ImageLinks;
}

export interface ImageListPage {
  images: ImageEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApikeyEntry {
  id: string;
  name: string;
  key: string;
  created: string;
  last_used: string | null;
}

export interface Settings {
  keep_original: boolean;
}

export interface Me {
  user: { id: string; username: string };
}

export interface UploadResult {
  id: string;
  file_name: string;
  links: ImageLinks;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

// SSR（window 無し）では api コンテナへ絶対 URL、client では相対（Caddy 経由）。
function resolveBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.KUV_API_BASE || "http://api:3001";
}

function withCookie(init: RequestInit | undefined, cookie: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  return { ...init, headers };
}

async function request<T>(
  path: string,
  init?: RequestInit,
  cookie?: string,
): Promise<T> {
  const finalInit = cookie ? withCookie(init, cookie) : init;
  const res = await fetch(resolveBase() + path, finalInit);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, cookie?: string): Promise<T> {
  return request<T>(path, undefined, cookie);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

// multipart アップロード（content-type はブラウザが boundary 付きで自動設定）
export function uploadImage(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  return request<UploadResult>("/api/image", { method: "POST", body: fd });
}
