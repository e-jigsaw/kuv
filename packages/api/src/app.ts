import { Hono } from "hono";
import type { Db } from "./db";
import { authMiddleware } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { imageRoutes } from "./routes/image";
import { iRoutes } from "./routes/i";
import { settingsRoutes } from "./routes/settings";
import { apikeyRoutes } from "./routes/apikey";
import type { BlobStore } from "./services/blob-store";
import type { AppBindings } from "./types";

export function createApp(database: Db, blob: BlobStore): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  // 全リクエストに db / blob と user を注入
  app.use("*", async (c, next) => {
    c.set("db", database);
    c.set("blob", blob);
    await next();
  });
  app.use("*", authMiddleware);

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/api/image", imageRoutes);
  app.route("/i", iRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/apikey", apikeyRoutes);

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
