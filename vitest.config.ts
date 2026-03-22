import { defineConfig } from "vitest/config";

/** Convex integration tests (convex-test + Vitest). Run: `bun run test:convex`. */
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.vitest.ts"],
    pool: "forks",
  },
});
