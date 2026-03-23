/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import { api } from "../convex/_generated/api";
import type { DataModel, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { DEFAULT_COLUMNS } from "../convex/projects";

const modules = import.meta.glob([
  "../convex/**/*.ts",
  "!../convex/**/*.test.ts",
  "../convex/_generated/**/*.js",
]);

async function ensureWorkerState(
  ctx: GenericMutationCtx<DataModel>,
  opts: { maxConcurrentCoding?: number },
) {
  const existing = await ctx.db
    .query("workerState")
    .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
    .unique();
  if (!existing) {
    await ctx.db.insert("workerState", {
      workerId: "default",
      lastPollAt: 0,
      activeCount: 0,
      maxConcurrentAgents: 3,
      ...(opts.maxConcurrentCoding !== undefined ? { maxConcurrentCoding: opts.maxConcurrentCoding } : {}),
    });
  } else if (opts.maxConcurrentCoding !== undefined) {
    await ctx.db.patch(existing._id, { maxConcurrentCoding: opts.maxConcurrentCoding });
  }
}

async function seedProjectWithWorkspaces(
  ctx: GenericMutationCtx<DataModel>,
  opts: {
    workspaceStatuses: [string, string];
    maxConcurrentCoding?: number | null;
    workerMaxConcurrentCoding?: number;
  },
): Promise<{ projectId: Id<"projects">; workspaceIds: [Id<"workspaces">, Id<"workspaces">] }> {
  const projectId = await ctx.db.insert("projects", {
    name: "P",
    slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "T",
    simpleIdCounter: 3,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    skipPlanning: true,
    createdAt: Date.now(),
    ...(opts.maxConcurrentCoding !== undefined ? { maxConcurrentCoding: opts.maxConcurrentCoding } : {}),
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

  const workspaceIds = [] as Id<"workspaces">[];
  for (let i = 0; i < 2; i++) {
    const issueId = await ctx.db.insert("issues", {
      projectId,
      simpleId: `T-${i + 1}`,
      title: `Issue ${i}`,
      description: "",
      status: "In Progress",
      tags: [],
      position: i,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const ws = await ctx.db.insert("workspaces", {
      issueId,
      projectId,
      worktrees: [],
      status: opts.workspaceStatuses[i] ?? "claimed",
      agentConfigId,
      agentCwd: "",
      createdAt: Date.now(),
    });
    workspaceIds.push(ws);
  }

  await ensureWorkerState(ctx, {
    maxConcurrentCoding: opts.workerMaxConcurrentCoding,
  });

  return { projectId, workspaceIds: workspaceIds as [Id<"workspaces">, Id<"workspaces">] };
}

describe("dispatch.canEnterPhase", () => {
  test("returns false when workspace row is missing", async () => {
    const t = convexTest(schema, modules);
    const deletedId = await t.run(async (ctx) => {
      const { workspaceIds } = await seedProjectWithWorkspaces(ctx, {
        workspaceStatuses: ["claimed", "claimed"],
      });
      const id = workspaceIds[0];
      await ctx.db.delete(id);
      return id;
    });
    const ok = await t.query(api.dispatch.canEnterPhase, {
      workspaceId: deletedId,
      phase: "coding",
    });
    expect(ok).toBe(false);
  });

  test("excludes self from phase count so a lone workspace in phase can still pass", async () => {
    const t = convexTest(schema, modules);
    const { workspaceIds } = await t.run((ctx) =>
      seedProjectWithWorkspaces(ctx, {
        workspaceStatuses: ["coding", "claimed"],
        workerMaxConcurrentCoding: 1,
      }),
    );
    const [onlyInCoding] = workspaceIds;
    const ok = await t.query(api.dispatch.canEnterPhase, {
      workspaceId: onlyInCoding,
      phase: "coding",
    });
    expect(ok).toBe(true);
  });

  test("blocks when global coding cap is reached by other workspaces", async () => {
    const t = convexTest(schema, modules);
    const { workspaceIds } = await t.run((ctx) =>
      seedProjectWithWorkspaces(ctx, {
        workspaceStatuses: ["coding", "claimed"],
        workerMaxConcurrentCoding: 1,
      }),
    );
    const [, waiting] = workspaceIds;
    const ok = await t.query(api.dispatch.canEnterPhase, {
      workspaceId: waiting,
      phase: "coding",
    });
    expect(ok).toBe(false);
  });

  test("blocks when per-project coding cap is reached by other workspaces in same project", async () => {
    const t = convexTest(schema, modules);
    const { workspaceIds } = await t.run((ctx) =>
      seedProjectWithWorkspaces(ctx, {
        workspaceStatuses: ["coding", "claimed"],
        maxConcurrentCoding: 1,
      }),
    );
    const [, waiting] = workspaceIds;
    const ok = await t.query(api.dispatch.canEnterPhase, {
      workspaceId: waiting,
      phase: "coding",
    });
    expect(ok).toBe(false);
  });

  test("per-project coding limit counts only workspaces in the same project", async () => {
    const t = convexTest(schema, modules);
    const { wsClaimedOther } = await t.run(async (ctx) => {
      const agentDefaults = {
        name: "agent",
        agentType: "claude-code" as const,
        command: "claude",
        args: [],
        timeoutMs: 60000,
        maxRetries: 3,
        retryBackoffMs: 1000,
        maxRetryBackoffMs: 10000,
        mcpEnabled: false,
      };

      const mkProject = async (slug: string, maxConcurrentCoding: number) => {
        const projectId = await ctx.db.insert("projects", {
          name: "P",
          slug,
          simpleIdPrefix: "T",
          simpleIdCounter: 2,
          maxReviewCycles: 3,
          cleanupDelayMs: 3600000,
          skipPlanning: true,
          createdAt: Date.now(),
          maxConcurrentCoding,
        });
        for (const col of DEFAULT_COLUMNS) {
          await ctx.db.insert("columns", { projectId, ...col });
        }
        const agentConfigId = await ctx.db.insert("agentConfigs", {
          projectId,
          ...agentDefaults,
        });
        return { projectId, agentConfigId };
      };

      const projA = await mkProject(`pa-${Date.now()}-${Math.random().toString(36).slice(2)}`, 1);
      const projB = await mkProject(`pb-${Date.now()}-${Math.random().toString(36).slice(2)}`, 1);

      const issueA = await ctx.db.insert("issues", {
        projectId: projA.projectId,
        simpleId: "T-1",
        title: "A",
        description: "",
        status: "In Progress",
        tags: [],
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("workspaces", {
        issueId: issueA,
        projectId: projA.projectId,
        worktrees: [],
        status: "coding",
        agentConfigId: projA.agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
      });

      const issueB = await ctx.db.insert("issues", {
        projectId: projB.projectId,
        simpleId: "T-1",
        title: "B",
        description: "",
        status: "In Progress",
        tags: [],
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const wsClaimedOther = await ctx.db.insert("workspaces", {
        issueId: issueB,
        projectId: projB.projectId,
        worktrees: [],
        status: "claimed",
        agentConfigId: projB.agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
      });

      await ensureWorkerState(ctx, {});
      return { wsClaimedOther };
    });

    const ok = await t.query(api.dispatch.canEnterPhase, {
      workspaceId: wsClaimedOther,
      phase: "coding",
    });
    expect(ok).toBe(true);
  });
});
