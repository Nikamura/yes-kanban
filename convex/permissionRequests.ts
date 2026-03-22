import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listPending = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("permissionRequests")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending")
      )
      .collect();
  },
});

export const getByRequestId = query({
  args: {
    runAttemptId: v.id("runAttempts"),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    // Use dedicated index for efficient lookup.
    // Return the most recent match to handle potential duplicate requestIds.
    const results = await ctx.db
      .query("permissionRequests")
      .withIndex("by_run_attempt_request", (q) =>
        q.eq("runAttemptId", args.runAttemptId).eq("requestId", args.requestId)
      )
      .collect();
    return results.length > 0 ? results[results.length - 1]! : null;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    runAttemptId: v.id("runAttempts"),
    toolName: v.string(),
    toolInput: v.optional(v.string()),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("permissionRequests", {
      workspaceId: args.workspaceId,
      runAttemptId: args.runAttemptId,
      toolName: args.toolName,
      toolInput: args.toolInput,
      requestId: args.requestId,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const respond = mutation({
  args: {
    id: v.id("permissionRequests"),
    status: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("always_allowed"),
    ),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Permission request not found");
    if (request.status !== "pending") {
      throw new Error("Permission request already resolved");
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      respondedAt: Date.now(),
    });
  },
});

/** Expire all pending permission requests for a run attempt by marking them as "rejected".
 *  Called when the agent process exits to clean up stale requests.
 *  Note: "rejected" covers both explicit user rejection and implicit expiry on process exit. */
export const expirePending = mutation({
  args: { runAttemptId: v.id("runAttempts") },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("permissionRequests")
      .withIndex("by_run_attempt_status", (q) =>
        q.eq("runAttemptId", args.runAttemptId).eq("status", "pending")
      )
      .collect();
    for (const req of pending) {
      await ctx.db.patch(req._id, {
        status: "rejected",
        respondedAt: Date.now(),
      });
    }
  },
});
