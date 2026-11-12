import { defineConfig } from "vitest/config";

/**
 * The cron Worker's tests are about SQL and time: they open a real `node:sqlite`
 * database with the web app's migrations applied and drive `scheduled()` with a
 * fake clock, so the environment is plain node.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
