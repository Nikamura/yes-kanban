import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Schedule a retry for a workspace with a computed dueAt time.
 */
export const schedule = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    attemptNumber: v.number(),
    dueAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("retries", {
      workspaceId: args.workspaceId,
      attemptNumber: args.attemptNumber,
      dueAt: args.dueAt,
      error: args.error,
      status: "pending",
    });
  },
});

/**
 * Find retries that are due for dispatch (status=pending, dueAt <= now).
 */
export const pending = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const retries = await ctx.db
      .query("retries")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "pending").lte("dueAt", args.now)
      )
      .collect();

    // Enrich with workspace data
    const enriched = await Promise.all(
      retries.map(async (retry) => {
        const workspace = await ctx.db.get(retry.workspaceId);
        if (!workspace) return null;

        const issue = workspace.issueId
          ? await ctx.db.get(workspace.issueId)
          : null;
        const agentConfig = await ctx.db.get(workspace.agentConfigId);

        return {
          ...retry,
          workspace,
          issue,
          agentConfig,
        };
      })
    );

    return enriched.filter(Boolean);
  },
});

/**
 * Mark a retry as dispatched.
 */
export const markDispatched = mutation({
  args: { id: v.id("retries") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "dispatched" });
  },
});

/**
 * Abandon a single retry.
 */
export const abandon = mutation({
  args: { id: v.id("retries") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "abandoned" });
  },
});

/**
 * Abandon all pending retries for a workspace.
 */
export const abandonForWorkspace = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const retries = await ctx.db
      .query("retries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    for (const retry of retries) {
      if (retry.status === "pending") {
        await ctx.db.patch(retry._id, { status: "abandoned" });
      }
    }
  },
});
