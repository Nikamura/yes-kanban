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

async function seedWithProject(
  ctx: GenericMutationCtx<DataModel>,
  opts: {
    skipPlanning?: boolean;
    issueStatus: string;
    workspaceStatus: string;
    plan?: string;
  },
) {
  const projectId = await ctx.db.insert("projects", {
    name: "P",
    slug: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    simpleIdPrefix: "T",
    simpleIdCounter: 2,
    maxReviewCycles: 3,
    cleanupDelayMs: 3600000,
    ...(opts.skipPlanning !== undefined ? { skipPlanning: opts.skipPlanning } : {}),
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
    status: opts.issueStatus,
    tags: [],
    position: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const workspaceId = await ctx.db.insert("workspaces", {
    issueId,
    projectId,
    worktrees: [],
    status: opts.workspaceStatus,
    agentConfigId,
    agentCwd: "",
    createdAt: Date.now(),
    ...(opts.plan !== undefined ? { plan: opts.plan } : {}),
  });
  return { projectId, agentConfigId, issueId, workspaceId };
}

describe("approvePlan auto-move", () => {
  test("does not move issue from In Progress into Done", async () => {
    const t = convexTest(schema, modules);
    const { issueId, workspaceId } = await t.run((ctx) =>
      seedWithProject(ctx, {
        issueStatus: "In Progress",
        workspaceStatus: "planning",
        plan: "# Plan",
      }),
    );

    await t.mutation(api.workspaces.approvePlan, { id: workspaceId });

    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue?.status).toBe("In Progress");
  });

  test("moves issue from To Do into In Progress when planning is enabled on project", async () => {
    const t = convexTest(schema, modules);
    const { issueId, workspaceId } = await t.run((ctx) =>
      seedWithProject(ctx, {
        skipPlanning: false,
        issueStatus: "To Do",
        workspaceStatus: "planning",
        plan: "# Plan",
      }),
    );

    await t.mutation(api.workspaces.approvePlan, { id: workspaceId });

    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue?.status).toBe("In Progress");
  });
});

describe("dispatch.claim auto-move with planning", () => {
  test("does not move issue off To Do when planning is enabled", async () => {
    const t = convexTest(schema, modules);
    const { issueId, workspaceId } = await t.run((ctx) =>
      seedWithProject(ctx, {
        skipPlanning: false,
        issueStatus: "To Do",
        workspaceStatus: "creating",
      }),
    );

    const claimed = await t.mutation(api.dispatch.claim, { workspaceId });
    expect(claimed).toBe(true);

    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue?.status).toBe("To Do");
  });

  test("moves To Do to In Progress when planning is skipped", async () => {
    const t = convexTest(schema, modules);
    const { issueId, workspaceId } = await t.run((ctx) =>
      seedWithProject(ctx, {
        skipPlanning: true,
        issueStatus: "To Do",
        workspaceStatus: "creating",
      }),
    );

    const claimed = await t.mutation(api.dispatch.claim, { workspaceId });
    expect(claimed).toBe(true);

    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue?.status).toBe("In Progress");
  });
});
