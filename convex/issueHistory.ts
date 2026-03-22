import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const list = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("issueHistory")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .order("desc")
      .take(100);
  },
});

/** Internal helper — call from other mutations to record a history entry. */
export async function recordHistory(
  ctx: MutationCtx,
  entry: {
    issueId: Id<"issues">;
    projectId: Id<"projects">;
    action: string;
    field: string;
    oldValue?: string;
    newValue?: string;
    actor: "user" | "system" | "agent";
  }
) {
  await ctx.db.insert("issueHistory", {
    ...entry,
    timestamp: Date.now(),
  });
}
