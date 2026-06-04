import { Hono } from "hono";
import { db, type Db } from "./db";
import { authMiddleware } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { imageRoutes } from "./routes/image";
import { iRoutes } from "./routes/i";
import type { AppBindings } from "./types";

export function createApp(database: Db): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  // 全リクエストに db と user を注入
  app.use("*", async (c, next) => {
    c.set("db", database);
    await next();
  });
  app.use("*", authMiddleware);

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/api/image", imageRoutes);
  app.route("/i", iRoutes);

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

// アプリ用シングルトン（server.ts と既存 health テストが使う）
export const app = createApp(db);
