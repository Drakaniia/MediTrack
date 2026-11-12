import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: [
      "node_modules/**",
      "**/node_modules/**",

      "apps/web/dist/**",
      "apps/web/.tanstack/**",
      "apps/web/src/routeTree.gen.ts",
      "apps/web/.wrangler/**",
      "workers/cron/dist/**",
      "workers/cron/.wrangler/**",
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
});
