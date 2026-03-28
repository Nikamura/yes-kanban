import { defineConfig } from "@playwright/test";

/**
 * Playwright config for isolated E2E testing.
 * Tests run in complete isolation using dynamically allocated ports.
 *
 * Run via: bun run test:e2e (uses ./scripts/test-e2e.sh)
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
