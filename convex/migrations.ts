import { mutation } from "./_generated/server";
import { FIXED_COLUMNS } from "./lib/boardConstants";
import { DEFAULT_COLUMNS } from "./projects";

const fixedSet = new Set(FIXED_COLUMNS as readonly string[]);

function mapLegacyStatus(status: string): string {
  if (status === "In Review") return "In Progress";
  if (status === "Cancelled") return "Done";
  if (!fixedSet.has(status)) return "Backlog";
  return status;
}

/**
 * One-time migration: fixed 4-column flow, project-level workflow settings, issue status cleanup.
 * Run after deploy: `npx convex run migrations:simplifyFlow`
 */
export const simplifyFlow = mutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    let projectsMigrated = 0;

    for (const project of projects) {
      const columns = await ctx.db
        .query("columns")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();

      const inProgress = columns.find((c) => c.name === "In Progress");
      const patch: Record<string, unknown> = {};
      if (inProgress) {
        if (inProgress.mergePolicy !== undefined) patch["mergePolicy"] = inProgress.mergePolicy;
        patch["skipReview"] = inProgress.skipReview;
        patch["skipTests"] = inProgress.skipTests;
        if (inProgress.skipPlanning !== undefined) patch["skipPlanning"] = inProgress.skipPlanning;
        if (inProgress.autoPlanReview !== undefined) patch["autoPlanReview"] = inProgress.autoPlanReview;
        if (inProgress.maxConcurrent !== undefined) patch["maxConcurrent"] = inProgress.maxConcurrent;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(project._id, patch);
      }

      const issues = await ctx.db
        .query("issues")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();

      const now = Date.now();
      for (const issue of issues) {
        const next = mapLegacyStatus(issue.status);
        if (next !== issue.status) {
          await ctx.db.patch(issue._id, { status: next, updatedAt: now });
        }
      }

      const workspaces = await ctx.db
        .query("workspaces")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      for (const ws of workspaces) {
        if (ws.sourceColumn) {
          const next = mapLegacyStatus(ws.sourceColumn);
          if (next !== ws.sourceColumn) {
            await ctx.db.patch(ws._id, { sourceColumn: next });
          }
        }
      }

      for (const col of columns) {
        await ctx.db.delete(col._id);
      }

      for (const col of DEFAULT_COLUMNS) {
        await ctx.db.insert("columns", {
          projectId: project._id,
          ...col,
        });
      }

      projectsMigrated++;
    }

    return { projectsMigrated };
  },
});
