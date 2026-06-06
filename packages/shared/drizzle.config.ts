import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    host: process.env.KUV_DB_HOST ?? "localhost",
    port: Number(process.env.KUV_DB_PORT ?? 5432),
    user: process.env.KUV_DB_USER ?? "kuv",
    password: process.env.KUV_DB_PASSWORD ?? "kuv",
    database: process.env.KUV_DB_DATABASE ?? "kuv",
    ssl: false,
  },
});
