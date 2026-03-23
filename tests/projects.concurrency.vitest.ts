/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob([
  "../convex/**/*.ts",
  "!../convex/**/*.test.ts",
  "../convex/_generated/**/*.js",
]);

describe("projects.update concurrency validation", () => {
  test("rejects maxConcurrent when set to 0", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.mutation(api.projects.create, {
      name: "P",
      slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      simpleIdPrefix: "T",
    });

    await expect(
      t.mutation(api.projects.update, { id: projectId, maxConcurrent: 0 }),
    ).rejects.toThrow(/maxConcurrent must be >= 1/);
  });

  test("rejects maxConcurrentPlanning when set to 0", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.mutation(api.projects.create, {
      name: "P",
      slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      simpleIdPrefix: "T",
    });

    await expect(
      t.mutation(api.projects.update, { id: projectId, maxConcurrentPlanning: 0 }),
    ).rejects.toThrow(/maxConcurrentPlanning must be >= 1/);
  });
});
