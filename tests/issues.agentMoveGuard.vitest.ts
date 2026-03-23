/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { GenericMutationCtx } from "convex/server";
import { describe, test, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { DataModel } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob([
  "../convex/**/*.ts",
  "!../convex/**/*.test.ts",
  "../convex/_generated/**/*.js",
]);

async function seedProject(ctx: GenericMutationCtx<DataModel>) {
  const projectId = await ctx.db.insert("projects", {
    name: "P",
    slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "T",
    simpleIdCounter: 1,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    createdAt: Date.now(),
  });
  return { projectId };
}

describe("issues agent move / update policy", () => {
  test("issues.move rejects agent targeting Done", async () => {
    const t = convexTest(schema, modules);
    const issueId = await t.run(async (ctx) => {
      const { projectId } = await seedProject(ctx);
      return await ctx.db.insert("issues", {
        projectId,
        simpleId: "T-0",
        title: "Issue",
        description: "",
        status: "In Progress",
        tags: [],
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.issues.move, {
        id: issueId,
        status: "Done",
        position: 0,
        actor: "agent",
      }),
    ).rejects.toThrow(/Agents are not allowed to move issues to "Done"/);
  });

  test("issues.update does not accept status (column moves require issues.move)", async () => {
    const t = convexTest(schema, modules);
    const issueId = await t.run(async (ctx) => {
      const { projectId } = await seedProject(ctx);
      return await ctx.db.insert("issues", {
        projectId,
        simpleId: "T-1",
        title: "Issue",
        description: "",
        status: "In Progress",
        tags: [],
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.issues.update, {
        id: issueId,
        status: "Done",
        actor: "agent",
      } as never),
    ).rejects.toThrow();
  });

  test("issues.update does not change status when only title is updated", async () => {
    const t = convexTest(schema, modules);
    const issueId = await t.run(async (ctx) => {
      const { projectId } = await seedProject(ctx);
      return await ctx.db.insert("issues", {
        projectId,
        simpleId: "T-2",
        title: "Issue",
        description: "",
        status: "In Progress",
        tags: [],
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.issues.update, {
      id: issueId,
      title: "Renamed",
      actor: "agent",
    });

    const after = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(after?.status).toBe("In Progress");
  });
});
