/// <reference types="vite/client" />
import component from "@convex-dev/migrations/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob([
  "../convex/**/*.ts",
  "!../convex/**/*.test.ts",
  "../convex/_generated/**/*.js",
]);

describe("migrations infrastructure", () => {
  test("runAll with empty serial list completes", async () => {
    const t = convexTest(schema, modules);
    // Migrations component schema is generic; convex-test expects a looser TestConvex.
    component.register(t as never);
    await expect(t.mutation(internal.migrations.runAll, {})).resolves.toBeNull();
  });

  test("run without fn rejects with library error", async () => {
    const t = convexTest(schema, modules);
    component.register(t as never);
    await expect(t.mutation(internal.migrations.run, {})).rejects.toThrow(
      /Specify the migration/,
    );
  });
});
