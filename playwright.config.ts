import { defineConfig } from "@playwright/test";

/**
 * Default Playwright config for ad-hoc runs: `bunx playwright test`.
 * Uses port 5174 and does not reuse an existing server so tests always hit
 * this worktree's Vite build (avoids accidentally testing a dev app on 5173).
 * Full stack E2E: `./scripts/test-e2e.sh` (isolated Convex + dynamic ports).
 */
export default defineConfig({
  testDir: "./e2e",
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
