import { defineConfig } from "@playwright/test";

/**
 * Default Playwright config for ad-hoc runs: `bunx playwright test`.
 * Uses port 5174 and does not reuse an existing server so tests always hit
 * this worktree's Vite build (avoids accidentally testing a dev app on 5173).
 * Full stack E2E: `./scripts/test-e2e.sh` (isolated Convex + dynamic ports).
 */
export default defineConfig({
  testDir: "./e2e",
  // Default Playwright match is *.(spec|test).* only; include *.e2e.ts so Bun can
  // avoid discovering e2e files (they use Playwright's test API, not bun:test).
  testMatch: ["**/*.@(spec|test).?(c|m)[jt]s?(x)", "**/*.e2e.ts"],
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  webServer: {
    command: "bunx --bun vite --port 5174",
    port: 5174,
    reuseExistingServer: false,
  },
});
