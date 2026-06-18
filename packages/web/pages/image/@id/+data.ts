import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { apiGet, UnauthorizedError } from "../../../lib/api";
import type { ImageEntry } from "../../../lib/api";

export type Data = { image: ImageEntry };

export async function data(pageContext: PageContextServer): Promise<Data> {
  const cookie = pageContext.headers?.["cookie"] ?? undefined;
  const id = pageContext.routeParams!.id!;
  try {
    const image = await apiGet<ImageEntry>(`/api/image/${id}`, cookie);
    return { image };
  } catch (e) {
    if (e instanceof UnauthorizedError) throw redirect("/login");
    throw e; // 404 等はそのまま vike のエラーページへ
  }
}
