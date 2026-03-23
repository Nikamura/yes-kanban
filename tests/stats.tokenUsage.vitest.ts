/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { GenericMutationCtx } from "convex/server";
import { describe, test, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { DataModel, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { DEFAULT_COLUMNS } from "../convex/projects";

const modules = import.meta.glob([
  "../convex/**/*.ts",
  "!../convex/**/*.test.ts",
  "../convex/_generated/**/*.js",
]);

const WINDOW_START = 1_700_000_000_000;
const WINDOW_END = WINDOW_START + 86_400_000;

async function seedProjectWithTwoWorkspaces(ctx: GenericMutationCtx<DataModel>) {
  const projectId = await ctx.db.insert("projects", {
    name: "Stats test",
    slug: `stats-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "ST",
    simpleIdCounter: 3,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    createdAt: Date.now(),
  });
  for (const col of DEFAULT_COLUMNS) {
    await ctx.db.insert("columns", { projectId, ...col });
  }
  const agentConfigId = await ctx.db.insert("agentConfigs", {
    projectId,
    name: "agent-a",
    agentType: "claude-code",
    command: "claude",
    args: [],
    timeoutMs: 60000,
    maxRetries: 3,
    retryBackoffMs: 1000,
    maxRetryBackoffMs: 10000,
    mcpEnabled: false,
  });

  const issue1 = await ctx.db.insert("issues", {
    projectId,
    simpleId: "ST-1",
    title: "I1",
    description: "",
    status: "In Progress",
    tags: [],
    position: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const issue2 = await ctx.db.insert("issues", {
    projectId,
    simpleId: "ST-2",
    title: "I2",
    description: "",
    status: "In Progress",
    tags: [],
    position: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const workspaceA = await ctx.db.insert("workspaces", {
    issueId: issue1,
    projectId,
    worktrees: [],
    status: "coding",
    agentConfigId,
    agentCwd: "",
    createdAt: Date.now(),
  });
  const workspaceB = await ctx.db.insert("workspaces", {
    issueId: issue2,
    projectId,
    worktrees: [],
    status: "coding",
    agentConfigId,
    agentCwd: "",
    createdAt: Date.now(),
  });

  return { projectId, agentConfigId, workspaceA, workspaceB };
}

async function insertAttempt(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    workspaceId: Id<"workspaces">;
    attemptNumber: number;
    startedAt: number;
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }
) {
  return await ctx.db.insert("runAttempts", {
    workspaceId: args.workspaceId,
    type: "coding",
    attemptNumber: args.attemptNumber,
    status: "succeeded",
    startedAt: args.startedAt,
    tokenUsage: args.tokenUsage,
  });
}

describe("stats.tokenUsage", () => {
  test("only includes attempts in [startTime, endTime]", async () => {
    const t = convexTest(schema, modules);
    const { projectId, workspaceA } = await t.run((ctx) => seedProjectWithTwoWorkspaces(ctx));

    await t.run(async (ctx) => {
      await insertAttempt(ctx, {
        workspaceId: workspaceA,
        attemptNumber: 1,
        startedAt: WINDOW_START + 1000,
        tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      });
      await insertAttempt(ctx, {
        workspaceId: workspaceA,
        attemptNumber: 2,
        startedAt: WINDOW_START - 1000,
        tokenUsage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
      });
      await insertAttempt(ctx, {
        workspaceId: workspaceA,
        attemptNumber: 3,
        startedAt: WINDOW_END + 1,
        tokenUsage: { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 },
      });
    });

    const result = await t.query(api.stats.tokenUsage, {
      projectId,
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    expect(result.totalRuns).toBe(1);
    expect(result.totalTokens).toBe(30);
    expect(result.recentRuns).toHaveLength(1);
    expect(result.recentRuns[0]?.startedAt).toBe(WINDOW_START + 1000);
  });

  test("recentRuns are globally newest by startedAt across workspaces", async () => {
    const t = convexTest(schema, modules);
    const { projectId, workspaceA, workspaceB } = await t.run((ctx) => seedProjectWithTwoWorkspaces(ctx));

    await t.run(async (ctx) => {
      await insertAttempt(ctx, {
        workspaceId: workspaceA,
        attemptNumber: 1,
        startedAt: WINDOW_START + 1,
      });
      await insertAttempt(ctx, {
        workspaceId: workspaceA,
        attemptNumber: 2,
        startedAt: WINDOW_START + 3,
      });
      await insertAttempt(ctx, {
        workspaceId: workspaceB,
        attemptNumber: 1,
        startedAt: WINDOW_START + 2,
      });
    });

    const result = await t.query(api.stats.tokenUsage, {
      projectId,
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    expect(result.totalRuns).toBe(3);
    const times = result.recentRuns.map((r) => r.startedAt);
    expect(times).toEqual([WINDOW_START + 3, WINDOW_START + 2, WINDOW_START + 1]);
  });
});
