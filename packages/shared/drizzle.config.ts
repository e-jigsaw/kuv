import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    host: process.env.PICSUR_DB_HOST ?? "localhost",
    port: Number(process.env.PICSUR_DB_PORT ?? 5432),
    user: process.env.PICSUR_DB_USER ?? "picsur",
    password: process.env.PICSUR_DB_PASSWORD ?? "picsur",
    database: process.env.PICSUR_DB_DATABASE ?? "picsur",
    ssl: false,
  },
});
