import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Frontend requests file content — dedup by workspace+path. */
export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing request (dedup)
    const existing = await ctx.db
      .query("fileContentRequests")
      .withIndex("by_workspace_path", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("filePath", args.filePath)
      )
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("fileContentRequests", {
      workspaceId: args.workspaceId,
      filePath: args.filePath,
      status: "pending",
    });
  },
});

/** Worker fulfills a file content request. */
export const fulfill = mutation({
  args: {
    id: v.id("fileContentRequests"),
    status: v.union(v.literal("fulfilled"), v.literal("error")),
    content: v.optional(v.string()),
    error: v.optional(v.string()),
    isBinary: v.optional(v.boolean()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

/** Frontend looks up file content by workspace + path. */
export const getByPath = query({
  args: {
    workspaceId: v.id("workspaces"),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fileContentRequests")
      .withIndex("by_workspace_path", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("filePath", args.filePath)
      )
      .first();
  },
});

/** Worker polls for pending requests. */
export const listPending = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("fileContentRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

/** Clean up all requests for a workspace (called on worktree removal). */
export const deleteByWorkspace = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const requests = await ctx.db
      .query("fileContentRequests")
      .withIndex("by_workspace_path", (q) =>
        q.eq("workspaceId", args.workspaceId)
      )
      .collect();
    for (const req of requests) {
      await ctx.db.delete(req._id);
    }
  },
});
