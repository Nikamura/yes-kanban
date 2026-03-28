/// <reference types="vite/client" />
import component from "@convex-dev/migrations/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { runAllSerialMigrations } from "../convex/migrations";
import schema from "../convex/schema";

const modules = import.meta.glob([
  "../convex/**/*.ts",
  "!../convex/**/*.test.ts",
  "../convex/_generated/**/*.js",
]);

describe("migrations infrastructure", () => {
  test("runAll serial order: backfills and YES-255 migrations are appended in order", () => {
    const order = runAllSerialMigrations();
    expect(order).toHaveLength(5);
    expect(order[0]).toEqual(internal.migrations.backfillRunAttemptsProjectId);
    expect(order[1]).toEqual(internal.migrations.backfillTokenUsageDaily);
    expect(order[2]).toEqual(internal.migrations.removeChecklistFromIssues);
    expect(order[3]).toEqual(internal.migrations.deleteAllSkills);
    expect(order[4]).toEqual(internal.migrations.clearAllowedToolPatterns);
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("runAll completes (drain scheduled migration work)", async () => {
    const t = convexTest(schema, modules);
    // Migrations component schema is generic; convex-test expects a looser TestConvex.
    component.register(t as never);
    await expect(t.mutation(internal.migrations.runAll, {})).resolves.toBeNull();
    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });
  });

  test("run without fn rejects with library error", async () => {
    const t = convexTest(schema, modules);
    component.register(t as never);
    await expect(t.mutation(internal.migrations.run, {})).rejects.toThrow(
      /Specify the migration/,
    );
  });
});
