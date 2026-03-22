import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { validateCommentBody } from "./lib/issueValidation";

export const list = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("comments")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .collect();
  },
});

export const create = mutation({
  args: {
    issueId: v.id("issues"),
    body: v.string(),
    author: v.string(),
    runAttemptId: v.optional(v.id("runAttempts")),
  },
  handler: async (ctx, args) => {
    validateCommentBody(args.body);
    return await ctx.db.insert("comments", {
      issueId: args.issueId,
      body: args.body,
      author: args.author,
      runAttemptId: args.runAttemptId,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
