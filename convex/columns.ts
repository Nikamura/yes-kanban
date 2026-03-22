import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return columns.sort((a, b) => a.position - b.position);
  },
});

export const update = mutation({
  args: {
    id: v.id("columns"),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const column = await ctx.db.get(id);
    if (!column) throw new Error("Column not found");

    const provided = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, val]) => val !== undefined)
    );
    if (Object.keys(provided).length > 0) {
      await ctx.db.patch(id, provided);
    }
  },
});
