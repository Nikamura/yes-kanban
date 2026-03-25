/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { GenericMutationCtx } from "convex/server";
import { describe, test, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { DataModel, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { DEFAULT_COLUMNS } from "../convex/projects";
import { utcDayString } from "../convex/tokenUsageAggregates";

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
    projectId: Id<"projects">;
    attemptNumber: number;
    startedAt: number;
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }
) {
  return await ctx.db.insert("runAttempts", {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
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
        projectId,
        workspaceId: workspaceA,
        attemptNumber: 1,
        startedAt: WINDOW_START + 1000,
        tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      });
      await insertAttempt(ctx, {
        projectId,
        workspaceId: workspaceA,
        attemptNumber: 2,
        startedAt: WINDOW_START - 1000,
        tokenUsage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
      });
      await insertAttempt(ctx, {
        projectId,
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
        projectId,
        workspaceId: workspaceA,
        attemptNumber: 1,
        startedAt: WINDOW_START + 1,
      });
      await insertAttempt(ctx, {
        projectId,
        workspaceId: workspaceA,
        attemptNumber: 2,
        startedAt: WINDOW_START + 3,
      });
      await insertAttempt(ctx, {
        projectId,
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

  test("aggregate totals match runAttempts completed via complete mutation", async () => {
    const t = convexTest(schema, modules);
    const { projectId, workspaceA } = await t.run((ctx) => seedProjectWithTwoWorkspaces(ctx));

    const runId1 = await t.mutation(api.runAttempts.create, {
      workspaceId: workspaceA,
      prompt: "one",
    });
    await t.mutation(api.runAttempts.complete, {
      id: runId1,
      status: "succeeded",
      tokenUsage: { inputTokens: 5, outputTokens: 15, totalTokens: 20 },
    });

    const runId2 = await t.mutation(api.runAttempts.create, {
      workspaceId: workspaceA,
      prompt: "two",
    });
    await t.mutation(api.runAttempts.complete, {
      id: runId2,
      status: "succeeded",
      tokenUsage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    });

    const now = Date.now();
    const result = await t.query(api.stats.tokenUsage, {
      projectId,
      startTime: now - 60_000,
      endTime: now + 60_000,
    });

    expect(result.totalRuns).toBe(2);
    expect(result.totalTokens).toBe(320);
    expect(result.totalInputTokens).toBe(105);
    expect(result.totalOutputTokens).toBe(215);
    expect(result.succeededRuns).toBe(2);
  });

  test("indexed query mixes raw days with prewritten tokenUsageDaily rows", async () => {
    const t = convexTest(schema, modules);
    const { projectId, workspaceA, agentConfigId } = await t.run((ctx) => seedProjectWithTwoWorkspaces(ctx));

    const dayB = "2024-01-11";
    const tA = Date.UTC(2024, 0, 10, 12, 0, 0);

    await t.run(async (ctx) => {
      await insertAttempt(ctx, {
        projectId,
        workspaceId: workspaceA,
        attemptNumber: 1,
        startedAt: tA,
        tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      await ctx.db.insert("tokenUsageDaily", {
        projectId,
        day: dayB,
        agentConfigId,
        agentConfigName: "agent-a",
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        runCount: 1,
        succeededRuns: 1,
        failedRuns: 0,
        timedOutRuns: 0,
        abandonedRuns: 0,
      });
    });

    const result = await t.query(api.stats.tokenUsage, {
      projectId,
      startTime: Date.UTC(2024, 0, 10, 0, 0, 0),
      // Inclusive end of Jan 11 UTC (must cover full last day for daily vs raw split)
      endTime: Date.UTC(2024, 0, 12) - 1,
    });

    expect(result.totalRuns).toBe(2);
    expect(result.totalTokens).toBe(32);
    expect(result.totalInputTokens).toBe(11);
  });

  test("full UTC day trusts tokenUsageDaily when present (skips raw for perf)", async () => {
    const t = convexTest(schema, modules);
    const { projectId, workspaceA, agentConfigId } = await t.run((ctx) => seedProjectWithTwoWorkspaces(ctx));

    const dayStr = "2024-06-01";
    const tMid = Date.UTC(2024, 5, 1, 11, 0, 0);

    await t.run(async (ctx) => {
      await ctx.db.insert("tokenUsageDaily", {
        projectId,
        day: dayStr,
        agentConfigId,
        agentConfigName: "agent-a",
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        runCount: 1,
        succeededRuns: 1,
        failedRuns: 0,
        timedOutRuns: 0,
        abandonedRuns: 0,
      });
      // This unbackfilled attempt is intentionally NOT merged — daily aggregates
      // are trusted to avoid reading all raw attempts per day (16 MiB limit).
      await insertAttempt(ctx, {
        projectId,
        workspaceId: workspaceA,
        attemptNumber: 2,
        startedAt: tMid,
        tokenUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      });
    });

    const result = await t.query(api.stats.tokenUsage, {
      projectId,
      startTime: Date.UTC(2024, 5, 1, 0, 0, 0),
      endTime: Date.UTC(2024, 5, 2) - 1,
    });

    // Only the daily aggregate row is counted (20), not the raw attempt (10).
    // The daily cron will pick up the unbackfilled attempt on its next run.
    expect(result.totalTokens).toBe(20);
    expect(result.totalRuns).toBe(1);
  });

  test("abandonRunning writes tokenUsageDaily with abandonedRuns", async () => {
    const t = convexTest(schema, modules);
    const { projectId, workspaceA, agentConfigId } = await t.run((ctx) => seedProjectWithTwoWorkspaces(ctx));

    await t.mutation(api.runAttempts.create, {
      workspaceId: workspaceA,
      prompt: "abandon-me",
    });
    await t.mutation(api.runAttempts.abandonRunning, { workspaceId: workspaceA });

    const startedAt = await t.run(async (ctx) => {
      const attempts = await ctx.db
        .query("runAttempts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceA))
        .collect();
      return attempts.find((x) => x.status === "abandoned")?.startedAt;
    });
    expect(startedAt).toBeDefined();
    const dayStr = utcDayString(startedAt!);

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("tokenUsageDaily")
        .withIndex("by_project_agent_day", (q) =>
          q.eq("projectId", projectId).eq("agentConfigId", agentConfigId).eq("day", dayStr)
        )
        .collect();
    });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r) => r.abandonedRuns === 1);
    expect(row).toBeDefined();
    expect(row?.runCount).toBe(1);
  });
});
