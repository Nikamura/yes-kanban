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

describe("workspaces.abandon", () => {
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
        worktrees: [
          {
            repoId: await ctx.db.insert("repos", {
              projectId,
              name: "r",
              slug: `r-${Date.now()}`,
              path: "/repo",
              defaultBranch: "main",
              scriptTimeoutMs: 60000,
              testTimeoutMs: 60000,
            }),
            repoPath: "x",
            baseBranch: "main",
            branchName: "feature",
            worktreePath: "/tmp/wt",
          },
        ],
        status: "completed",
        agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
      });
      await ctx.db.delete(wsId);
      return wsId;
    });
    await expect(t.mutation(api.workspaces.abandon, { id: staleId })).rejects.toThrow(
      "Workspace not found",
    );
  });

  test("rejects non-terminal workspace", async () => {
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
        worktrees: [
          {
            repoId,
            repoPath: "x",
            baseBranch: "main",
            branchName: "feature",
            worktreePath: "/tmp/wt",
          },
        ],
        status: "coding",
        agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
      });
    });
    await expect(t.mutation(api.workspaces.abandon, { id: wsId })).rejects.toThrow(
      "Use cancel for active workspaces",
    );
  });

  test("rejects terminal workspace with no worktrees", async () => {
    const t = convexTest(schema, modules);
    const wsId = await t.run(async (ctx) => {
      const { projectId, agentConfigId } = await seedProjectWithAgent(ctx);
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
        worktrees: [],
        status: "completed",
        agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
      });
    });
    await expect(t.mutation(api.workspaces.abandon, { id: wsId })).rejects.toThrow(
      "No worktrees to clean up",
    );
  });

  test("sets terminal workspace with worktrees to cancelled", async () => {
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
        simpleId: "T-3",
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
        status: "completed",
        agentConfigId,
        agentCwd: "",
        createdAt: Date.now(),
        completedAt: Date.now(),
      });
    });

    await t.mutation(api.workspaces.abandon, { id: wsId });

    const status = await t.run(async (ctx) => {
      const ws = await ctx.db.get(wsId);
      return ws?.status;
    });
    expect(status).toBe("cancelled");
  });
});
