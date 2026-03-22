import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .collect();
    return Promise.all(
      attachments.map(async (a) => ({
        ...a,
        url: await ctx.storage.getUrl(a.storageId),
      }))
    );
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    issueId: v.id("issues"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("attachments", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("attachments") },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.id);
    if (attachment) {
      await ctx.storage.delete(attachment.storageId);
      await ctx.db.delete(args.id);
    }
  },
});
