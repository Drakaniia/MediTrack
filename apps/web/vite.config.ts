/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** `wrangler pages dev` serves the Functions API here (see scripts/web-dev.mjs). */
const API_ORIGIN = "http://127.0.0.1:8788";

/**
 * Two vitest projects share one `vp test` run:
 *
 * - `server` — node. Pure domain code (`shared/`), the API (`server/`,
 *   `functions/`) and its D1 harness (`test/`). Deliberately does NOT load the
 *   Vite plugins below: these tests are about SQL and HTTP, and the router
 *   plugin would regenerate `routeTree.gen.ts` for no reason.
 * - `client` — jsdom. The SPA (`src/`).
 *
 * The timeouts are the desktop app's: any test that opens a Base UI popup
 * spends 15-30s in React's act flush under jsdom (the component work itself is
 * sub-second), so the 5s default reports timeouts on tests that are passing.
 */
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({
      autoCodeSplitting: true,
      target: "react",
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3002,
    proxy: {
      // changeOrigin MUST stay false: the proxied request keeps `Host: localhost:3002`, so
      // the Functions see request.url = http://localhost:3002/... and the CSRF check
      // (Origin === new URL(request.url).origin) passes for the browser's Origin header.
      "/api": { changeOrigin: false, target: API_ORIGIN },
    },
  },
  test: {
    globals: true,
    hookTimeout: 30_000,
    passWithNoTests: true,
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          environment: "node",
          exclude: ["node_modules", "dist", ".tanstack", ".wrangler"],
          globals: true,
          hookTimeout: 30_000,
          include: [
            "shared/**/*.test.ts",
            "server/**/*.test.ts",
            "functions/**/*.test.ts",
            "test/**/*.test.ts",
          ],
          name: "server",
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          environment: "jsdom",
          exclude: ["node_modules", "dist", ".tanstack", ".wrangler"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          name: "client",
          setupFiles: ["./src/test/setup.ts"],
          testTimeout: 30_000,
        },
      },
    ],
    testTimeout: 30_000,
  },
});
