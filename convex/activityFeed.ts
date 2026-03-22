import { v } from "convex/values";
import { query } from "./_generated/server";

export const recent = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const history = await ctx.db
      .query("issueHistory")
      .withIndex("by_project_time", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 50);

    // Enrich with issue titles
    const issueIds = [...new Set(history.map((h) => h.issueId))];
    const issues = await Promise.all(issueIds.map((id) => ctx.db.get(id)));
    const issueMap = new Map(
      issues.filter((i): i is NonNullable<typeof i> => i !== null).map((i) => [i._id, i])
    );

    return history.map((h) => ({
      ...h,
      issueTitle: issueMap.get(h.issueId)?.title ?? "Deleted issue",
      issueSimpleId: issueMap.get(h.issueId)?.simpleId ?? "?",
    }));
  },
});
