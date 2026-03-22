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

describe("workspaces.remove", () => {
  test("rejects when workspace does not exist", async () => {
    const t = convexTest(schema, modules);
    const staleId = await t.run(async (ctx) => {
      const { projectId, agentConfigId } = await seedProjectWithAgent(ctx);
      const issueId = await ctx.db.insert("issues", {
        projectId,
        simpleId: "T-0",
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
      await ctx.db.delete(wsId);
      return wsId;
    });
    await expect(t.mutation(api.workspaces.remove, { id: staleId })).rejects.toThrow(
      "Workspace not found",
    );
  });

  test("rejects non-terminal workspace", async () => {
    const t = convexTest(schema, modules);
    const wsId = await t.run(async (ctx) => {
      const { projectId, agentConfigId } = await seedProjectWithAgent(ctx);
      const issueId = await ctx.db.insert("issues", {
        projectId,
        simpleId: "T-1",
        title: "Issue",
        description: "",
        status: "Backlog",
        tags: [],
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("workspaces", {
        issueId,
        projectId,
        worktrees: [],
        status: "coding",
        agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
      });
    });
    await expect(t.mutation(api.workspaces.remove, { id: wsId })).rejects.toThrow(
      "Only finished workspaces can be deleted",
    );
  });

  test("rejects terminal workspace with non-empty worktrees", async () => {
    const t = convexTest(schema, modules);
    const wsId = await t.run(async (ctx) => {
      const { projectId, agentConfigId } = await seedProjectWithAgent(ctx);
      const repoId = await ctx.db.insert("repos", {
        projectId,
        name: "r",
        slug: `r-${Date.now()}`,
        path: "/repo",
        defaultBranch: "main",
        scriptTimeoutMs: 60000,
        testTimeoutMs: 60000,
      });
      const issueId = await ctx.db.insert("issues", {
        projectId,
        simpleId: "T-2",
        title: "Issue",
        description: "",
        status: "Backlog",
        tags: [],
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("workspaces", {
        issueId,
        projectId,
        worktrees: [
          {
            repoId,
            repoPath: "x",
            baseBranch: "main",
            branchName: "feature",
            worktreePath: "/tmp/wt",
          },
        ],
        status: "cancelled",
        agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
      });
    });
    await expect(t.mutation(api.workspaces.remove, { id: wsId })).rejects.toThrow(
      "Worktrees must be cleaned up before deleting this workspace",
    );
  });

  test("clears comment runAttemptId and deletes workspace and run data", async () => {
    const t = convexTest(schema, modules);
    const { wsId, issueId } = await t.run(async (ctx) => {
      const { projectId, agentConfigId } = await seedProjectWithAgent(ctx);
      const issueId = await ctx.db.insert("issues", {
        projectId,
        simpleId: "T-3",
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
      const raId = await ctx.db.insert("runAttempts", {
        workspaceId: wsId,
        type: "run",
        attemptNumber: 1,
        prompt: "hi",
        status: "finished",
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
      await ctx.db.insert("agentLogs", {
        runAttemptId: raId,
        workspaceId: wsId,
        timestamp: Date.now(),
        stream: "stdout",
        line: "log",
      });
      await ctx.db.insert("agentQuestions", {
        workspaceId: wsId,
        question: "ok?",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.insert("comments", {
        issueId,
        body: "note",
        author: "agent",
        runAttemptId: raId,
        createdAt: Date.now(),
      });
      return { wsId, issueId };
    });

    await t.mutation(api.workspaces.remove, { id: wsId });

    const after = await t.run(async (ctx) => {
      const ws = await ctx.db.get(wsId);
      const questions = await ctx.db
        .query("agentQuestions")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
        .collect();
      const attempts = await ctx.db
        .query("runAttempts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
        .collect();
      const comment = await ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", issueId))
        .first();
      return { ws, questions, attempts, comment };
    });

    expect(after.ws).toBeNull();
    expect(after.questions).toHaveLength(0);
    expect(after.attempts).toHaveLength(0);
    expect(after.comment).not.toBeNull();
    expect(after.comment!.runAttemptId).toBeUndefined();
  });
});
