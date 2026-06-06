import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  noExternal: [/@kuv\/shared/, /^hono/, /@hono\/node-server/],
});
