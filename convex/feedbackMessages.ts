import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("feedbackMessages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const listPending = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("feedbackMessages")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending")
      )
      .collect();
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("feedbackMessages", {
      workspaceId: args.workspaceId,
      body: args.body,
      author: "user",
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const markDelivered = mutation({
  args: { id: v.id("feedbackMessages") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) throw new Error("Message not found");
    await ctx.db.patch(args.id, {
      status: "delivered",
      deliveredAt: Date.now(),
    });
  },
});

export const markBatchDelivered = mutation({
  args: { ids: v.array(v.id("feedbackMessages")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      const msg = await ctx.db.get(id);
      if (msg?.status === "pending") {
        await ctx.db.patch(id, { status: "delivered", deliveredAt: now });
      }
    }
  },
});
