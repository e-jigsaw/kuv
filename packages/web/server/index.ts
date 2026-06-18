import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { renderPage } from "vike/server";

const app = new Hono();

// vike が出力する静的アセット。content-hash 付きなので長期キャッシュ可。
app.use("/assets/*", serveStatic({ root: "./dist/client" }));
app.get("/favicon.ico", serveStatic({ path: "./dist/client/favicon.ico" }));

// それ以外は vike SSR に流す。
// pageContext.headers["cookie"] を各 +data が読んで API 認証に使う。
app.all("*", async (c) => {
  const pageContext = await renderPage({
    urlOriginal: c.req.url,
    headersOriginal: c.req.raw.headers,
  });
  const { httpResponse } = pageContext;
  if (!httpResponse) return c.notFound();
  return new Response(httpResponse.getReadableWebStream(), {
    status: httpResponse.statusCode,
    headers: httpResponse.headers,
  });
});

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`kuv web listening on http://localhost:${port}`);
