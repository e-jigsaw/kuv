import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vike from "vike/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), vike(), tailwindcss()],
  server: {
    // dev では vite が web を配信するので、api への経路をプロキシして単一オリジン化（本番は Caddy）
    proxy: {
      "/api": "http://localhost:3001",
      "/i": "http://localhost:3001",
    },
  },
});
