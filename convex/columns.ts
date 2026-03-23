import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { FIXED_COLUMNS } from "./lib/boardConstants";
import { recordHistory } from "./issueHistory";

const fixedSet = new Set<string>(FIXED_COLUMNS);

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return columns
      .filter((c) => fixedSet.has(c.name))
      .sort((a, b) => a.position - b.position);
  },
});

/** Delete legacy columns and move issues with invalid statuses back to Backlog. */
export const cleanupLegacyColumns = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Delete non-fixed columns
    let deletedColumns = 0;
    for (const col of columns) {
      if (!fixedSet.has(col.name)) {
        await ctx.db.delete(col._id);
        deletedColumns++;
      }
    }

    // Find issues with invalid statuses and move them to Backlog
    const allIssues = await ctx.db
      .query("issues")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
      .collect();

    let movedIssues = 0;
    for (const issue of allIssues) {
      if (!fixedSet.has(issue.status)) {
        await recordHistory(ctx, {
          issueId: issue._id,
          projectId: issue.projectId,
          action: "moved",
          field: "status",
          oldValue: JSON.stringify(issue.status),
          newValue: JSON.stringify("Backlog"),
          actor: "system",
        });
        await ctx.db.patch(issue._id, {
          status: "Backlog",
          updatedAt: Date.now(),
        });
        movedIssues++;
      }
    }

    return { deletedColumns, movedIssues };
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
