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
  opts: { maxConcurrentCoding?: number; maxConcurrentPlanning?: number },
) {
  const existing = await ctx.db
    .query("workerState")
    .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
    .unique();
  const patch: Record<string, number> = {};
  if (opts.maxConcurrentCoding !== undefined) patch["maxConcurrentCoding"] = opts.maxConcurrentCoding;
  if (opts.maxConcurrentPlanning !== undefined) patch["maxConcurrentPlanning"] = opts.maxConcurrentPlanning;

  if (!existing) {
    await ctx.db.insert("workerState", {
      workerId: "default",
      lastPollAt: 0,
      activeCount: 0,
      maxConcurrentAgents: 3,
      ...patch,
    });
  } else if (Object.keys(patch).length > 0) {
    await ctx.db.patch(existing._id, patch);
  }
}

async function seedCodingAndCreating(
  ctx: GenericMutationCtx<DataModel>,
  opts: { workerMaxConcurrentCoding: number },
): Promise<{ creatingWorkspaceId: Id<"workspaces"> }> {
  const projectId = await ctx.db.insert("projects", {
    name: "P",
    slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "T",
    simpleIdCounter: 3,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    skipPlanning: true,
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

  const statuses = ["coding", "creating"] as const;
  let creatingWorkspaceId!: Id<"workspaces">;

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
    const st = statuses[i];
    if (!st) throw new Error("seedCodingAndCreating: missing status");
    const ws = await ctx.db.insert("workspaces", {
      issueId,
      projectId,
      worktrees: [],
      status: st,
      agentConfigId,
      agentCwd: "",
      createdAt: Date.now(),
    });
    if (st === "creating") {
      creatingWorkspaceId = ws;
    }
  }

  await ensureWorkerState(ctx, {
    maxConcurrentCoding: opts.workerMaxConcurrentCoding,
  });

  return { creatingWorkspaceId };
}

async function seedPlanningAndCreating(
  ctx: GenericMutationCtx<DataModel>,
  opts: { workerMaxConcurrentPlanning: number },
): Promise<{ creatingWorkspaceId: Id<"workspaces"> }> {
  const projectId = await ctx.db.insert("projects", {
    name: "P",
    slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "T",
    simpleIdCounter: 3,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    skipPlanning: false,
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

  const statuses = ["planning", "creating"] as const;
  let creatingWorkspaceId!: Id<"workspaces">;

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
    const st = statuses[i];
    if (!st) throw new Error("seedPlanningAndCreating: missing status");
    const ws = await ctx.db.insert("workspaces", {
      issueId,
      projectId,
      worktrees: [],
      status: st,
      agentConfigId,
      agentCwd: "",
      createdAt: Date.now(),
    });
    if (st === "creating") {
      creatingWorkspaceId = ws;
    }
  }

  await ensureWorkerState(ctx, {
    maxConcurrentPlanning: opts.workerMaxConcurrentPlanning,
  });

  return { creatingWorkspaceId };
}

describe("dispatch.next", () => {
  test("returns null when initial phase (planning without skipPlanning) is at global capacity", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      seedPlanningAndCreating(ctx, {
        workerMaxConcurrentPlanning: 1,
      }),
    );
    const next = await t.query(api.dispatch.next, {});
    expect(next).toBeNull();
  });

  test("returns null when initial phase (coding with skipPlanning) is at global capacity", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      seedCodingAndCreating(ctx, {
        workerMaxConcurrentCoding: 1,
      }),
    );
    const next = await t.query(api.dispatch.next, {});
    expect(next).toBeNull();
  });

  test("returns queued creating workspace when initial phase has capacity", async () => {
    const t = convexTest(schema, modules);
    const { creatingWorkspaceId } = await t.run((ctx) =>
      seedCodingAndCreating(ctx, {
        workerMaxConcurrentCoding: 2,
      }),
    );
    const next = await t.query(api.dispatch.next, {});
    expect(next).not.toBeNull();
    expect(next?.workspaceId).toEqual(creatingWorkspaceId);
  });
});
