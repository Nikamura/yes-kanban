import { internalMutation } from "./_generated/server";
import { TERMINAL_COLUMN_NAMES, WORKSPACE_TERMINAL_STATUSES } from "./workspaces";
import { recordHistory } from "./issueHistory";

export const runAutoArchive = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    const now = Date.now();

    for (const project of projects) {
      if (!project.autoArchiveDelayMs || project.autoArchiveDelayMs <= 0) continue;

      const cutoff = now - project.autoArchiveDelayMs;

      // Find issues in terminal columns that are old enough and not archived
      for (const columnName of TERMINAL_COLUMN_NAMES) {
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", project._id).eq("status", columnName)
          )
          .collect();

        for (const issue of issues) {
          if (issue.archivedAt !== undefined) continue;
          if (issue.updatedAt >= cutoff) continue;

          // Skip issues with active workspaces
          const workspaces = await ctx.db
            .query("workspaces")
            .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
            .collect();
          const hasActive = workspaces.some(
            (w) => !(WORKSPACE_TERMINAL_STATUSES as readonly string[]).includes(w.status)
          );
          if (hasActive) continue;

          await ctx.db.patch(issue._id, { archivedAt: now, updatedAt: now });
          await recordHistory(ctx, {
            issueId: issue._id,
            projectId: project._id,
            action: "archived",
            field: "archivedAt",
            newValue: JSON.stringify(now),
            actor: "system",
          });
        }
      }
    }
  },
});
