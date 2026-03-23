import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentQuestions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const listPending = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentQuestions")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending")
      )
      .collect();
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    question: v.string(),
    suggestedAnswers: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    if (args.suggestedAnswers && args.suggestedAnswers.length !== 3) {
      throw new Error("suggestedAnswers must contain exactly 3 items");
    }
    return await ctx.db.insert("agentQuestions", {
      workspaceId: args.workspaceId,
      question: args.question,
      suggestedAnswers: args.suggestedAnswers,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

async function autoContinuePlanningIfReady(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const remaining = await ctx.db
    .query("agentQuestions")
    .withIndex("by_workspace_status", (q) =>
      q.eq("workspaceId", workspaceId).eq("status", "pending")
    )
    .first();

  if (!remaining) {
    const workspace = await ctx.db.get(workspaceId);
    if (workspace?.status === "awaiting_feedback" || workspace?.status === "waiting_for_answer") {
      await ctx.db.patch(workspaceId, {
        status: "creating",
        planApproved: undefined,
      });
    }
  }
}

export const answer = mutation({
  args: {
    id: v.id("agentQuestions"),
    answer: v.string(),
  },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.id);
    if (!question) throw new Error("Question not found");
    await ctx.db.patch(args.id, {
      answer: args.answer,
      status: "answered",
      answeredAt: Date.now(),
    });
    await autoContinuePlanningIfReady(ctx, question.workspaceId);
  },
});

export const dismiss = mutation({
  args: { id: v.id("agentQuestions") },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.id);
    if (!question) throw new Error("Question not found");
    await ctx.db.patch(args.id, { status: "dismissed" });
    await autoContinuePlanningIfReady(ctx, question.workspaceId);
  },
});
