import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
    const existing = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const id = await ctx.db.insert("runAttempts", {
      workspaceId: args.workspaceId,
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
    await ctx.db.patch(id, {
      ...updates,
      finishedAt: Date.now(),
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
    const attempts = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    let count = 0;
    for (const attempt of attempts) {
      if (attempt.status === "running") {
        await ctx.db.patch(attempt._id, {
          status: "abandoned",
          finishedAt: Date.now(),
          error: "Run abandoned (worker restart or cancel)",
        });
        count++;
      }
    }
    return count;
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
