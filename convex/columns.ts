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

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const maxPosition = existing.reduce((max, col) => Math.max(max, col.position), -1);

    return await ctx.db.insert("columns", {
      projectId: args.projectId,
      name: args.name,
      color: args.color,
      position: maxPosition + 1,
      visible: true,
      autoDispatch: false,
      skipReview: false,
      skipTests: false,
      skipPlanning: false,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("columns"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    position: v.optional(v.number()),
    visible: v.optional(v.boolean()),
    autoDispatch: v.optional(v.boolean()),
    mergePolicy: v.optional(v.union(v.string(), v.null())),
    skipReview: v.optional(v.boolean()),
    skipTests: v.optional(v.boolean()),
    skipPlanning: v.optional(v.boolean()),
    autoPlanReview: v.optional(v.boolean()),
    maxConcurrent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const column = await ctx.db.get(id);
    if (!column) throw new Error("Column not found");

    // Strip args not provided (undefined), but keep null → undefined to clear fields via patch
    const provided = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );
    // Convert null to undefined so Convex patch removes the field
    for (const [k, v] of Object.entries(provided)) {
      if (v === null) provided[k] = undefined;
    }
    if (Object.keys(provided).length > 0) {
      await ctx.db.patch(id, provided);
    }
  },
});

export const remove = mutation({
  args: {
    id: v.id("columns"),
    targetColumnId: v.id("columns"),
  },
  handler: async (ctx, args) => {
    const column = await ctx.db.get(args.id);
    if (!column) throw new Error("Column not found");

    const target = await ctx.db.get(args.targetColumnId);
    if (!target) throw new Error("Target column not found");

    if (column.projectId !== target.projectId) {
      throw new Error("Columns must belong to the same project");
    }

    // Check at least one visible column remains
    const allColumns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", column.projectId))
      .collect();
    const visibleAfter = allColumns.filter(
      (c) => c._id !== args.id && c.visible
    );
    if (visibleAfter.length === 0) {
      throw new Error("Cannot delete the last visible column");
    }

    // Move issues to target column
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", column.projectId).eq("status", column.name)
      )
      .collect();
    for (const issue of issues) {
      await ctx.db.patch(issue._id, {
        status: target.name,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.delete(args.id);
  },
});
