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

async function seedProjectWithAgent(ctx: GenericMutationCtx<DataModel>) {
  const projectId = await ctx.db.insert("projects", {
    name: "P",
    slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "T",
    simpleIdCounter: 1,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    createdAt: Date.now(),
  });
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
  return { projectId, agentConfigId };
}

async function seedCancelledWorkspace(ctx: GenericMutationCtx<DataModel>) {
  const { projectId, agentConfigId } = await seedProjectWithAgent(ctx);
  const issueId = await ctx.db.insert("issues", {
    projectId,
    simpleId: `T-${Date.now()}`,
    title: "Issue",
    description: "",
    status: "Backlog",
    tags: [],
    position: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const wsId = await ctx.db.insert("workspaces", {
    issueId,
    projectId,
    worktrees: [],
    status: "cancelled",
    agentConfigId,
    agentCwd: "",
    createdAt: Date.now(),
  });
  return { wsId, projectId, agentConfigId, issueId };
}

describe("runAttemptPrompts (YES-203)", () => {
  test("runAttempts.create stores prompt in runAttemptPrompts, not on runAttempts", async () => {
    const t = convexTest(schema, modules);
    const wsId = await t.run(async (ctx) => {
      const { wsId } = await seedCancelledWorkspace(ctx);
      return wsId;
    });

    const promptText = "round-trip prompt body";
    const raId = await t.mutation(api.runAttempts.create, {
      workspaceId: wsId,
      prompt: promptText,
    });

    const stored = await t.run(async (ctx) => {
      const ra = await ctx.db.get(raId);
      const promptRows = await ctx.db
        .query("runAttemptPrompts")
        .withIndex("by_runAttempt", (q) => q.eq("runAttemptId", raId))
        .collect();
      return { ra, promptRows };
    });

    expect(stored.ra).not.toBeNull();
    expect(stored.ra!.prompt).toBeUndefined();
    expect(stored.promptRows).toHaveLength(1);
    expect(stored.promptRows[0]!.prompt).toBe(promptText);
  });

  test("workspaces.get resolves prompt from runAttemptPrompts", async () => {
    const t = convexTest(schema, modules);
    const wsId = await t.run(async (ctx) => {
      const { wsId } = await seedCancelledWorkspace(ctx);
      return wsId;
    });

    const promptText = "visible in workspace view";
    await t.mutation(api.runAttempts.create, {
      workspaceId: wsId,
      prompt: promptText,
    });

    const workspace = await t.query(api.workspaces.get, { id: wsId });
    expect(workspace).not.toBeNull();
    const prompts = workspace!.runAttempts.map((a) => a.prompt);
    expect(prompts).toContain(promptText);
  });

  test("workspaces.get falls back to legacy inline prompt when no runAttemptPrompts row", async () => {
    const t = convexTest(schema, modules);
    const wsId = await t.run(async (ctx) => {
      const { wsId } = await seedCancelledWorkspace(ctx);
      await ctx.db.insert("runAttempts", {
        workspaceId: wsId,
        type: "coding",
        attemptNumber: 1,
        prompt: "legacy-inline-only",
        status: "succeeded",
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return wsId;
    });

    const workspace = await t.query(api.workspaces.get, { id: wsId });
    expect(workspace!.runAttempts.some((a) => a.prompt === "legacy-inline-only")).toBe(true);
  });

  test("workspaces.remove deletes runAttemptPrompts rows for attempts", async () => {
    const t = convexTest(schema, modules);
    const wsId = await t.run(async (ctx) => {
      const { wsId } = await seedCancelledWorkspace(ctx);
      return wsId;
    });

    await t.mutation(api.runAttempts.create, {
      workspaceId: wsId,
      prompt: "to be deleted with workspace",
    });

    await t.mutation(api.workspaces.remove, { id: wsId });

    const after = await t.run(async (ctx) => {
      const prompts = await ctx.db.query("runAttemptPrompts").collect();
      return { prompts };
    });
    expect(after.prompts).toHaveLength(0);
  });

  test("projects.remove deletes runAttemptPrompts rows for nested attempts", async () => {
    const t = convexTest(schema, modules);
    const { projectId, wsId } = await t.run(async (ctx) => {
      const { projectId, wsId } = await seedCancelledWorkspace(ctx);
      return { projectId, wsId };
    });

    await t.mutation(api.runAttempts.create, {
      workspaceId: wsId,
      prompt: "deleted when project is removed",
    });

    await t.mutation(api.projects.remove, { id: projectId });

    const after = await t.run(async (ctx) => {
      const prompts = await ctx.db.query("runAttemptPrompts").collect();
      const projects = await ctx.db.get(projectId);
      return { prompts, projects };
    });
    expect(after.projects).toBeNull();
    expect(after.prompts).toHaveLength(0);
  });
});
