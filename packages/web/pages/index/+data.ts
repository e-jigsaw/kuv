import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { apiGet, UnauthorizedError } from "../../lib/api";
import type { ImageEntry } from "../../lib/api";

export type Data = { images: ImageEntry[] };

export async function data(pageContext: PageContextServer): Promise<Data> {
  const cookie = pageContext.headers?.["cookie"] ?? undefined;
  try {
    const { images } = await apiGet<{ images: ImageEntry[] }>(
      "/api/image/list",
      cookie,
    );
    return { images };
  } catch (e) {
    if (e instanceof UnauthorizedError) throw redirect("/login");
    throw e;
  }
}
