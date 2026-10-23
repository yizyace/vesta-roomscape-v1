import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createApiMiddleware } from "./server/api.ts";

// Local, single-user tool: bind to the loopback interface only.
const HOST = "127.0.0.1";

// The JSON API and the data files (server/api.ts) on both `npm run dev` and `npm run preview`.
// Vite runs its host check before plugin middlewares, so DNS-rebound requests never reach them.
const furnitureApi: Plugin = {
  name: "furniture-api",
  configureServer(server) {
    server.middlewares.use(createApiMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(createApiMiddleware());
  },
};

export default defineConfig({
  plugins: [react(), furnitureApi],
  server: { host: HOST, port: 5173 },
  preview: { host: HOST, port: 4173 },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
