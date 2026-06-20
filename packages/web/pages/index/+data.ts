import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { apiGet, UnauthorizedError } from "../../lib/api";
import type { ImageListPage } from "../../lib/api";

export type Data = ImageListPage;

export async function data(pageContext: PageContextServer): Promise<Data> {
  const cookie = pageContext.headers?.["cookie"] ?? undefined;
  const raw = (pageContext.urlParsed.search as Record<string, string>).page;
  const parsed = Number.parseInt(raw ?? "", 10);
  const page = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  try {
    return await apiGet<Data>(`/api/image/list?page=${page}`, cookie);
  } catch (e) {
    if (e instanceof UnauthorizedError) throw redirect("/login");
    throw e;
  }
}
