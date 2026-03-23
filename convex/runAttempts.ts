import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { upsertTokenUsageDailyForTerminalAttempt } from "./tokenUsageAggregates";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentConfigId: v.optional(v.id("agentConfigs")),
    type: v.optional(v.string()),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const existing = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const id = await ctx.db.insert("runAttempts", {
      workspaceId: args.workspaceId,
      projectId: workspace.projectId,
      agentConfigId: args.agentConfigId,
      type: args.type ?? "coding",
      attemptNumber: existing.length + 1,
      status: "running",
      startedAt: Date.now(),
    });
    await ctx.db.insert("runAttemptPrompts", { runAttemptId: id, prompt: args.prompt });
    return id;
  },
});

export const complete = mutation({
  args: {
    id: v.id("runAttempts"),
    status: v.string(),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        totalTokens: v.number(),
        cacheCreationInputTokens: v.optional(v.number()),
        cacheReadInputTokens: v.optional(v.number()),
      })
    ),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const attempt = await ctx.db.get(id);
    if (!attempt) {
      throw new Error("Run attempt not found");
    }
    const workspace = await ctx.db.get(attempt.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const projectId = workspace.projectId;
    const effectiveAgentConfigId = attempt.agentConfigId ?? workspace.agentConfigId;
    const agentConfig = await ctx.db.get(effectiveAgentConfigId);

    await ctx.db.patch(id, {
      ...updates,
      finishedAt: Date.now(),
      projectId,
      tokenUsageDailyBackfilled: true,
    });

    await upsertTokenUsageDailyForTerminalAttempt(ctx, {
      projectId,
      agentConfigId: effectiveAgentConfigId,
      agentConfigName: agentConfig?.name ?? "Unknown",
      model: agentConfig?.model,
      startedAt: attempt.startedAt,
      status: args.status,
      tokenUsage: args.tokenUsage,
    });
  },
});

/**
 * Mark all "running" run attempts for a workspace as "abandoned".
 * Used when a workspace is recovered after worker restart or cancelled
 * to prevent orphaned run attempts from showing as permanently running.
 */
export const abandonRunning = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const attempts = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    let count = 0;
    for (const attempt of attempts) {
      if (attempt.status === "running") {
        const effectiveAgentConfigId = attempt.agentConfigId ?? workspace.agentConfigId;
        const agentConfig = await ctx.db.get(effectiveAgentConfigId);

        await ctx.db.patch(attempt._id, {
          status: "abandoned",
          finishedAt: Date.now(),
          error: "Run abandoned (worker restart or cancel)",
          projectId: workspace.projectId,
          tokenUsageDailyBackfilled: true,
        });

        await upsertTokenUsageDailyForTerminalAttempt(ctx, {
          projectId: workspace.projectId,
          agentConfigId: effectiveAgentConfigId,
          agentConfigName: agentConfig?.name ?? "Unknown",
          model: agentConfig?.model,
          startedAt: attempt.startedAt,
          status: "abandoned",
        });

        count++;
      }
    }
    return count;
  },
});

/** Latest run attempt of a given type (by insertion order under by_workspace). */
export const lastByType = query({
  args: { workspaceId: v.id("workspaces"), type: v.string() },
  handler: async (ctx, args) => {
    const attempts = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (let i = attempts.length - 1; i >= 0; i--) {
      if (attempts[i]?.type === args.type) return attempts[i];
    }
    return null;
  },
});

/** Get the most recent successful run attempt for a workspace to retrieve its sessionId. */
export const lastSession = query({
  args: { workspaceId: v.id("workspaces"), type: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const attempts = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    // Find the most recent attempt with a sessionId, optionally filtered by type
    for (let i = attempts.length - 1; i >= 0; i--) {
      const attempt = attempts[i];
      if (attempt?.sessionId && (!args.type || attempt.type === args.type)) return attempt;
    }
    return null;
  },
});
