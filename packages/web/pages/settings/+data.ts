import { redirect } from "vike/abort";
import type { PageContextServer } from "vike/types";
import { apiGet, UnauthorizedError } from "../../lib/api";
import type { ApikeyEntry, Settings } from "../../lib/api";

export type Data = { settings: Settings; apikeys: ApikeyEntry[] };

export async function data(pageContext: PageContextServer): Promise<Data> {
  const cookie = pageContext.headers?.["cookie"] ?? undefined;
  try {
    const [settings, apikeyRes] = await Promise.all([
      apiGet<Settings>("/api/settings", cookie),
      apiGet<{ apikeys: ApikeyEntry[] }>("/api/apikey", cookie),
    ]);
    return { settings, apikeys: apikeyRes.apikeys };
  } catch (e) {
    if (e instanceof UnauthorizedError) throw redirect("/login");
    throw e;
  }
}
