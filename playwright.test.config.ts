import { defineConfig } from "@playwright/test";

/**
 * Playwright config for isolated E2E testing.
 * Uses separate ports so tests can run alongside the real app.
 *
 * Test Convex: port 3220 (vs prod 3210)
 * Test Vite:   port 5174 (vs prod 5173)
 *
 * Run via: ./scripts/test-e2e.sh
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.@(spec|test).?(c|m)[jt]s?(x)", "**/*.e2e.ts"],
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5174",
    headless: true,
  },
  // No webServer — the test script manages Vite lifecycle
});
