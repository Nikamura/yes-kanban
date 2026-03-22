import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { validateCommentBody } from "./lib/issueValidation";
import { recordHistory } from "./issueHistory";

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
    const commentId = await ctx.db.insert("comments", {
      issueId: args.issueId,
      body: args.body,
      author: args.author,
      runAttemptId: args.runAttemptId,
      createdAt: Date.now(),
    });
    const issue = await ctx.db.get(args.issueId);
    if (issue) {
      await recordHistory(ctx, {
        issueId: args.issueId,
        projectId: issue.projectId,
        action: "updated",
        field: "comment",
        newValue: JSON.stringify({
          action: "add",
          author: args.author,
          body: args.body.slice(0, 200),
        }),
        actor: "user",
      });
    }
    return commentId;
  },
});

export const remove = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.id);
    if (!comment) return;
    const issue = await ctx.db.get(comment.issueId);
    if (issue) {
      await recordHistory(ctx, {
        issueId: comment.issueId,
        projectId: issue.projectId,
        action: "updated",
        field: "comment",
        newValue: JSON.stringify({
          action: "remove",
          body: comment.body.slice(0, 200),
        }),
        actor: "user",
      });
    }
    await ctx.db.delete(args.id);
  },
});
