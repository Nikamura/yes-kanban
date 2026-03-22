import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getNextVisibleColumn } from "./lib/columnHelpers";
import { recordHistory } from "./issueHistory";
import { TERMINAL_COLUMN_NAMES } from "./lib/boardConstants";
export { TERMINAL_COLUMN_NAMES } from "./lib/boardConstants";

/** Workspace statuses where the agent is no longer running and a new workspace can be created. */
export const WORKSPACE_TERMINAL_STATUSES = [
  "completed", "failed", "cancelled", "merged",
  "merge_failed", "conflict", "test_failed", "changes_requested",
] as const;

/** Move an issue to the next visible column. Shared by updateStatus, dismissReviewFeedback, approvePlan, and claim. */
export async function autoMoveIssueToNextColumn(
  ctx: MutationCtx,
  issueId: Id<"issues">,
  projectId: Id<"projects">,
  opts?: { onlyIfAutoDispatch?: boolean; skipTerminal?: boolean },
) {
  const issue = await ctx.db.get(issueId);
  if (!issue) return;

  const columns = await ctx.db
    .query("columns")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();

  if (opts?.onlyIfAutoDispatch) {
    const currentColumn = columns.find((c) => c.name === issue.status);
    if (!currentColumn?.autoDispatch) return;
  }

  const nextColumn = getNextVisibleColumn(columns, issue.status);
  if (!nextColumn || nextColumn.name === issue.status) return;

  // Don't auto-move into terminal columns (Done/Cancelled) — user must do that explicitly
  if (opts?.skipTerminal && TERMINAL_COLUMN_NAMES.includes(nextColumn.name)) return;

  const issuesInTarget = await ctx.db
    .query("issues")
    .withIndex("by_project_status", (q) =>
      q.eq("projectId", issue.projectId).eq("status", nextColumn.name)
    )
    .collect();
  const maxPos = issuesInTarget.reduce((max, i) => Math.max(max, i.position), -1);

  await recordHistory(ctx, {
    issueId: issue._id,
    projectId: issue.projectId,
    action: "moved",
    field: "status",
    oldValue: JSON.stringify(issue.status),
    newValue: JSON.stringify(nextColumn.name),
    actor: "system",
  });

  await ctx.db.patch(issue._id, {
    status: nextColumn.name,
    position: maxPos + 1,
    updatedAt: Date.now(),
  });
}

export const listByIssue = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .collect();
  },
});

const ACTIVE_STATUSES = [
  "creating", "claimed", "planning", "plan_reviewing", "awaiting_feedback", "coding", "testing", "reviewing", "rebasing",
  "pr_open", "creating_pr", "merging", "merge_failed", "test_failed", "changes_requested", "conflict",
] as const;

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const results = await Promise.all(
      ACTIVE_STATUSES.map((s) =>
        ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", s)).collect()
      )
    );
    return results.flat();
  },
});

/** Returns workspaces that should be checked for branch divergence. */
const BRANCH_CHECK_STATUSES = [
  ...ACTIVE_STATUSES, "completed",
] as const;

export const listForBranchCheck = query({
  args: {},
  handler: async (ctx) => {
    const results = await Promise.all(
      BRANCH_CHECK_STATUSES.map((s) =>
        ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", s)).collect()
      )
    );
    return results.flat().filter((w) => w.worktrees.length > 0);
  },
});

/**
 * Statuses where worktrees can be cleaned up.
 * Excludes completed/changes_requested/conflict/merge_failed (user can still
 * create PRs, retry, rebase) and pr_open (worktree needed for rebase/merge).
 */
const CLEANUP_STATUSES = ["merged", "cancelled", "failed", "test_failed"] as const;
export const listReadyForCleanup = query({
  args: {},
  handler: async (ctx) => {
    const results = await Promise.all(
      CLEANUP_STATUSES.map((s) =>
        ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", s)).collect()
      )
    );
    return results.flat().filter((w) => w.worktrees.length > 0);
  },
});

/** Clear worktrees from a merged workspace after cleanup. */
export const clearWorktrees = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, { worktrees: [] });
  },
});

/** Returns workspaces pending manual actions (creating_pr, merging). */
export const listPendingActions = query({
  args: {},
  handler: async (ctx) => {
    const [creatingPr, merging] = await Promise.all([
      ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", "creating_pr")).collect(),
      ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", "merging")).collect(),
    ]);
    return [...creatingPr, ...merging];
  },
});

/** Returns the latest workspace status for each issue in a project. */
export const latestByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Group by issueId, keep only the latest (by createdAt)
    const latest = new Map<string, { status: string; behindMainBy?: number; workspaceId: string; createdAt: number }>();
    for (const ws of workspaces) {
      if (!ws.issueId) continue;
      const existing = latest.get(ws.issueId);
      if (!existing || ws.createdAt > existing.createdAt) {
        latest.set(ws.issueId, { status: ws.status, behindMainBy: ws.behindMainBy, workspaceId: ws._id, createdAt: ws.createdAt });
      }
    }

    return Object.fromEntries(
      Array.from(latest.entries()).map(([id, val]) => [id, { status: val.status, behindMainBy: val.behindMainBy, workspaceId: val.workspaceId }])
    );
  },
});

export const get = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) return null;

    const rawRunAttempts = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.id))
      .collect();

    const agentConfig = await ctx.db.get(workspace.agentConfigId);

    // Resolve agent config for each run attempt (for badge/model display)
    const configCache = new Map<string, { agentType: string; model?: string; name: string } | null>();
    const runAttempts = await Promise.all(
      rawRunAttempts.map(async (ra) => {
        let attemptAgent: { agentType: string; model?: string; name: string } | null = null;
        if (ra.agentConfigId) {
          const key = ra.agentConfigId;
          if (configCache.has(key)) {
            attemptAgent = configCache.get(key) ?? null;
          } else {
            const cfg = await ctx.db.get(ra.agentConfigId);
            attemptAgent = cfg ? { agentType: cfg.agentType, model: cfg.model, name: cfg.name } : null;
            configCache.set(key, attemptAgent);
          }
        }
        return { ...ra, agentConfig: attemptAgent };
      }),
    );

    return {
      ...workspace,
      runAttempts,
      agentConfig,
    };
  },
});

export const create = mutation({
  args: {
    issueId: v.optional(v.id("issues")),
    projectId: v.id("projects"),
    agentConfigId: v.id("agentConfigs"),
    additionalPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaces", {
      issueId: args.issueId,
      projectId: args.projectId,
      worktrees: [],
      status: "creating",
      agentConfigId: args.agentConfigId,
      agentCwd: "",
      createdAt: Date.now(),
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("workspaces"),
    status: v.string(),
    worktrees: v.optional(
      v.array(
        v.object({
          repoId: v.id("repos"),
          repoPath: v.string(),
          baseBranch: v.string(),
          branchName: v.string(),
          worktreePath: v.string(),
        })
      )
    ),
    agentCwd: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    diffOutput: v.optional(v.string()),
    reviewFeedback: v.optional(v.string()),
    lastError: v.optional(v.string()),
    skipAutoMove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, skipAutoMove, ...updates } = args;
    const workspace = await ctx.db.get(id);
    if (!workspace) throw new Error("Workspace not found");

    const filtered = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, filtered);

    // Auto-move issue to next column on key workspace transitions
    if (skipAutoMove) return;
    if (!workspace.issueId) return;
    const shouldAutoMove =
      args.status === "claimed" || args.status === "completed" || args.status === "merged";
    if (!shouldAutoMove) return;

    const moveOpts =
      args.status === "claimed"
        ? { onlyIfAutoDispatch: true }
        : args.status === "completed"
          ? { skipTerminal: true }
          : undefined;
    await autoMoveIssueToNextColumn(
      ctx, workspace.issueId, workspace.projectId, moveOpts,
    );
  },
});

export const clearReviewFeedback = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, { reviewFeedback: undefined });
  },
});

export const clearReviewRequested = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, { reviewRequested: undefined });
  },
});

export const setSourceColumn = mutation({
  args: { id: v.id("workspaces"), sourceColumn: v.string() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, { sourceColumn: args.sourceColumn });
  },
});

export const retry = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    const retryableStatuses = ["failed", "test_failed", "changes_requested", "merge_failed", "cancelled"];
    if (!retryableStatuses.includes(workspace.status)) {
      throw new Error(`Cannot retry workspace with status "${workspace.status}"`);
    }
    // Merge failures only need to retry the merge step, not the whole lifecycle
    let retryStatus: string = "creating";
    let reviewRequested: boolean | undefined;
    if (workspace.status === "merge_failed") {
      retryStatus = "merging";
    } else if (workspace.status === "failed") {
      // If coding already succeeded at some point, skip straight to review.
      // Auto-retries after a review failure re-run the full lifecycle, creating
      // new failed coding attempts — so we can't just check the last attempt type.
      const attempts = await ctx.db
        .query("runAttempts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.id))
        .collect();
      const hasSuccessfulCoding = attempts.some(
        (a) => a.type === "coding" && a.status === "succeeded",
      );
      const hasReviewAttempt = attempts.some((a) => a.type === "review");
      if (hasSuccessfulCoding && hasReviewAttempt) {
        reviewRequested = true;
      }
    }
    await ctx.db.patch(args.id, {
      status: retryStatus,
      cancelRequested: undefined,
      completedAt: undefined,
      reviewRequested,
    });
  },
});

export const dismissReviewFeedback = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (workspace.status !== "changes_requested") {
      throw new Error(`Cannot dismiss feedback for workspace with status "${workspace.status}"`);
    }
    await ctx.db.patch(args.id, {
      status: "completed",
      reviewFeedback: undefined,
      completedAt: Date.now(),
    });
    if (workspace.issueId) {
      await autoMoveIssueToNextColumn(ctx, workspace.issueId, workspace.projectId);
    }
  },
});

export const requestReview = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (!["completed", "changes_requested"].includes(workspace.status)) {
      throw new Error(`Cannot request review for workspace with status "${workspace.status}"`);
    }
    if (workspace.worktrees.length === 0) {
      throw new Error("Cannot request review: no worktrees available");
    }
    await ctx.db.patch(args.id, {
      status: "creating",
      reviewRequested: true,
      reviewFeedback: undefined,
      cancelRequested: undefined,
      completedAt: undefined,
    });
  },
});

export const requestChanges = mutation({
  args: { id: v.id("workspaces"), instructions: v.string() },
  handler: async (ctx, args) => {
    if (!args.instructions.trim()) {
      throw new Error("Instructions cannot be empty");
    }
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (!["completed", "changes_requested"].includes(workspace.status)) {
      throw new Error(`Cannot request changes for workspace with status "${workspace.status}"`);
    }
    if (workspace.worktrees.length === 0) {
      throw new Error("Cannot request changes: no worktrees available");
    }
    await ctx.db.patch(args.id, {
      status: "creating",
      reviewFeedback: args.instructions.trim(),
      reviewRequested: undefined,
      cancelRequested: undefined,
      completedAt: undefined,
    });
  },
});

export const requestCancel = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    const cancellableStatuses = ["creating", "claimed", "planning", "plan_reviewing", "awaiting_feedback", "coding", "testing", "reviewing", "rebasing", "creating_pr", "merging"];
    if (!cancellableStatuses.includes(workspace.status)) {
      throw new Error(`Cannot cancel workspace with status "${workspace.status}"`);
    }
    await ctx.db.patch(args.id, { cancelRequested: true });
  },
});

/** Lightweight mutation to update the file tree listing. */
export const updateFileTree = mutation({
  args: {
    id: v.id("workspaces"),
    fileTree: v.string(),
    fileTreeTruncated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, {
      fileTree: args.fileTree,
      fileTreeTruncated: args.fileTreeTruncated,
    });
  },
});

/** Lightweight mutation to update just the diff output (used for live diff polling). */
export const updateDiff = mutation({
  args: {
    id: v.id("workspaces"),
    diffOutput: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, { diffOutput: args.diffOutput });
  },
});

export const updateBranchStatus = mutation({
  args: {
    id: v.id("workspaces"),
    behindMainBy: v.number(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, { behindMainBy: args.behindMainBy });
  },
});

export const requestRebase = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    const rebasableStatuses = ["pr_open", "completed", "conflict", "changes_requested", "merge_failed"];
    if (!rebasableStatuses.includes(workspace.status)) {
      throw new Error(`Cannot rebase workspace with status "${workspace.status}"`);
    }
    // Preserve the original previousStatus when re-rebasing from conflict —
    // conflict is not a meaningful restore target; the real status was saved
    // on the first transition into rebasing.
    const preservePrevious = workspace.status === "conflict" && workspace.previousStatus;
    await ctx.db.patch(args.id, {
      status: "rebasing",
      previousStatus: preservePrevious ? workspace.previousStatus : workspace.status,
    });
  },
});

export const requestCreatePR = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (!["completed", "changes_requested"].includes(workspace.status)) {
      throw new Error(`Cannot create PR for workspace with status "${workspace.status}"`);
    }
    // Clear stale cancelRequested so the worker doesn't skip this workspace
    await ctx.db.patch(args.id, { status: "creating_pr", cancelRequested: undefined });
  },
});

export const requestLocalMerge = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (!["completed", "changes_requested"].includes(workspace.status)) {
      throw new Error(`Cannot merge workspace with status "${workspace.status}"`);
    }
    // Clear stale cancelRequested so the worker doesn't skip this workspace
    await ctx.db.patch(args.id, { status: "merging", cancelRequested: undefined });
  },
});

export const updatePlan = mutation({
  args: {
    id: v.id("workspaces"),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    await ctx.db.patch(args.id, { plan: args.plan });
  },
});

export const approvePlan = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    if (!workspace.plan) throw new Error("No plan to approve");
    // Set to "creating" so the worker picks it up again — lifecycle will skip
    // planning since planApproved is true and proceed to coding
    await ctx.db.patch(args.id, {
      planApproved: true,
      status: "creating",
      experimentNumber: workspace.experimentNumber ?? 1,
    });

    // Auto-move issue to next column on plan approval
    if (workspace.issueId) {
      await autoMoveIssueToNextColumn(ctx, workspace.issueId, workspace.projectId);
    }
  },
});

export const restartExperiment = mutation({
  args: {
    id: v.id("workspaces"),
    updatedPlan: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    const currentExp = workspace.experimentNumber ?? 1;
    await ctx.db.patch(args.id, {
      status: "creating",
      experimentNumber: currentExp + 1,
      cancelRequested: undefined,
      completedAt: undefined,
      diffOutput: undefined,
      behindMainBy: undefined,
      reviewFeedback: undefined,
      reviewRequested: undefined,
      ...(args.updatedPlan ? { plan: args.updatedPlan } : {}),
    });
  },
});

export const requestPlanning = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.id);
    if (!workspace) throw new Error("Workspace not found");
    // Go back to creating so the worker picks it up — lifecycle will enter
    // planning since planApproved is false
    await ctx.db.patch(args.id, {
      status: "creating",
      planApproved: undefined,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    // Delete run attempts and their logs
    const runAttempts = await ctx.db
      .query("runAttempts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.id))
      .collect();
    for (const ra of runAttempts) {
      const logs = await ctx.db
        .query("agentLogs")
        .withIndex("by_run_attempt", (q) => q.eq("runAttemptId", ra._id))
        .collect();
      for (const log of logs) {
        await ctx.db.delete(log._id);
      }
      await ctx.db.delete(ra._id);
    }

    await ctx.db.delete(args.id);
  },
});
