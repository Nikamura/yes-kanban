/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { GenericMutationCtx } from "convex/server";
import { describe, test, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { DataModel } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { DEFAULT_COLUMNS } from "../convex/projects";

const modules = import.meta.glob([
  "../convex/**/*.ts",
  "!../convex/**/*.test.ts",
  "../convex/_generated/**/*.js",
]);

async function seedBoard(ctx: GenericMutationCtx<DataModel>, workspaceStatus: string) {
  const projectId = await ctx.db.insert("projects", {
    name: "P",
    slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "T",
    simpleIdCounter: 2,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    createdAt: Date.now(),
  });
  for (const col of DEFAULT_COLUMNS) {
    await ctx.db.insert("columns", { projectId, ...col });
  }
  const agentConfigId = await ctx.db.insert("agentConfigs", {
    projectId,
    name: "agent",
    agentType: "claude-code",
    command: "claude",
    args: [],
    timeoutMs: 60000,
    maxRetries: 3,
    retryBackoffMs: 1000,
    maxRetryBackoffMs: 10000,
    mcpEnabled: false,
  });
  const issueId = await ctx.db.insert("issues", {
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
  const workspaceId = await ctx.db.insert("workspaces", {
    issueId,
    projectId,
    worktrees: [],
    status: workspaceStatus,
    agentConfigId,
    agentCwd: "",
    createdAt: Date.now(),
  });
  return { projectId, agentConfigId, issueId, workspaceId };
}

describe("workspaces.updateStatus auto-move", () => {
  test("merged does not move issue into Done", async () => {
    const t = convexTest(schema, modules);
    const { issueId, workspaceId } = await t.run((ctx) => seedBoard(ctx, "merging"));

    await t.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "merged",
    });

    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue?.status).toBe("In Progress");
  });

  test("completed does not move issue into Done (skip terminal)", async () => {
    const t = convexTest(schema, modules);
    const { issueId, workspaceId } = await t.run((ctx) => seedBoard(ctx, "coding"));

    await t.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "completed",
      completedAt: Date.now(),
    });

    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue?.status).toBe("In Progress");
  });
});
