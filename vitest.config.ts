import { defineConfig } from "vitest/config";

/** Integration tests for `api.workspaces.remove` (convex-test + Vitest). Run: `bun run test:convex`. */
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/workspaces.remove.vitest.ts"],
    pool: "forks",
  },
});
