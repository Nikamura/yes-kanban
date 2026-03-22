import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    runAttemptId: v.id("runAttempts"),
    after: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("agentLogs")
      .withIndex("by_run_attempt", (q) => {
        const base = q.eq("runAttemptId", args.runAttemptId);
        if (args.after !== undefined) {
          return base.gt("timestamp", args.after);
        }
        return base;
      })
      .order("asc");

    if (args.limit) {
      return await q.take(args.limit);
    }
    return await q.collect();
  },
});

export const append = mutation({
  args: {
    runAttemptId: v.id("runAttempts"),
    workspaceId: v.id("workspaces"),
    stream: v.string(),
    line: v.string(),
    structured: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentLogs", {
      runAttemptId: args.runAttemptId,
      workspaceId: args.workspaceId,
      timestamp: Date.now(),
      stream: args.stream,
      line: args.line,
      structured: args.structured,
    });
  },
});

export const appendBatch = mutation({
  args: {
    entries: v.array(
      v.object({
        runAttemptId: v.id("runAttempts"),
        workspaceId: v.id("workspaces"),
        stream: v.string(),
        line: v.string(),
        structured: v.optional(v.any()),
        timestamp: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const entry of args.entries) {
      await ctx.db.insert("agentLogs", {
        runAttemptId: entry.runAttemptId,
        workspaceId: entry.workspaceId,
        timestamp: entry.timestamp ?? Date.now(),
        stream: entry.stream,
        line: entry.line,
        structured: entry.structured,
      });
    }
  },
});
