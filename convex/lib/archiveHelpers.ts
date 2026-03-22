import type { MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import { recordHistory } from "../issueHistory";

/** Unarchive a single issue: resolves target column, sets position, clears archivedAt, records history. */
export async function unarchiveIssue(
  ctx: MutationCtx,
  issue: Doc<"issues">,
  actor: "user" | "system" = "user",
) {
  // Check if original column still exists; if not, use first visible column
  const columns = await ctx.db
    .query("columns")
    .withIndex("by_project", (q) => q.eq("projectId", issue.projectId))
    .collect();
  const columnExists = columns.some((c) => c.name === issue.status);
  const targetStatus = columnExists
    ? issue.status
    : (columns.filter((c) => c.visible).sort((a, b) => a.position - b.position)[0]?.name ?? issue.status);

  // Get max position in target column
  const existingInColumn = await ctx.db
    .query("issues")
    .withIndex("by_project_status", (q) =>
      q.eq("projectId", issue.projectId).eq("status", targetStatus)
    )
    .collect();
  const maxPos = existingInColumn.reduce((max, i) => Math.max(max, i.position), -1);

  const now = Date.now();
  await ctx.db.patch(issue._id, {
    archivedAt: undefined,
    status: targetStatus,
    position: maxPos + 1,
    updatedAt: now,
  });
  await recordHistory(ctx, {
    issueId: issue._id,
    projectId: issue.projectId,
    action: "unarchived",
    field: "archivedAt",
    oldValue: JSON.stringify(issue.archivedAt),
    actor,
  });
}
