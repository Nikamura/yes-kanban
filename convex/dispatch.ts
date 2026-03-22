import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { autoMoveIssueToNextColumn, TERMINAL_COLUMN_NAMES } from "./workspaces";

const TERMINAL_STATUSES = TERMINAL_COLUMN_NAMES as readonly string[];
const RUNNING_STATUSES = ["claimed", "planning", "coding", "testing", "reviewing", "rebasing"] as const;

/**
 * Check if any blocker issue is unresolved.
 * Returns true if any blocker is NOT in a terminal status (Done).
 * Deleted blockers (null) are treated as resolved.
 */
export function isBlockedByUnresolved(
  blockerIssues: Array<{ status: string } | null>,
): boolean {
  return blockerIssues.some(
    (issue) => issue !== null && !TERMINAL_STATUSES.includes(issue.status),
  );
}

export const next = query({
  args: {},
  handler: async (ctx) => {
    // Find workspaces in "creating" status (queued for dispatch)
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_status", (q) => q.eq("status", "creating"))
      .collect();

    if (workspaces.length === 0) return null;

    // Sort workspaces (FIFO by creation time)
    const withIssues = await Promise.all(
      workspaces.map(async (ws) => {
        const issue = ws.issueId ? await ctx.db.get(ws.issueId) : null;
        const agentConfig = await ctx.db.get(ws.agentConfigId);
        const repos = await ctx.db
          .query("repos")
          .withIndex("by_project", (q) => q.eq("projectId", ws.projectId))
          .collect();
        const project = await ctx.db.get(ws.projectId);
        return { workspace: ws, issue, agentConfig, repos, project };
      })
    );

    // Filter out workspaces whose issues have unresolved blockers
    const unblocked = [];
    for (const entry of withIssues) {
      if (entry.issue?.blockedBy && entry.issue.blockedBy.length > 0) {
        const blockerIssues = await Promise.all(
          entry.issue.blockedBy.map((id) => ctx.db.get(id)),
        );
        if (isBlockedByUnresolved(blockerIssues as Array<{ status: string } | null>)) {
          continue; // Skip blocked workspace
        }
      }
      unblocked.push(entry);
    }

    if (unblocked.length === 0) return null;

    // Sort: oldest workspace first (FIFO)
    unblocked.sort((a, b) => a.workspace.createdAt - b.workspace.createdAt);

    const projectIds = [...new Set(unblocked.map((w) => w.workspace.projectId))];
    const [allRunning, ...projectDocs] = await Promise.all([
      Promise.all(
        RUNNING_STATUSES.map((s) =>
          ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", s)).collect()
        )
      ).then((results) => results.flat()),
      ...projectIds.map((pid) => ctx.db.get(pid)),
    ]);

    const projectsById = new Map(projectIds.map((id, i) => [id, projectDocs[i]]));

    const runningPerProject: Record<string, number> = {};
    for (const ws of allRunning) {
      if (!ws.issueId) continue;
      const pid = ws.projectId;
      runningPerProject[pid] = (runningPerProject[pid] ?? 0) + 1;
    }

    const first = unblocked.find((candidate) => {
      const pid = candidate.workspace.projectId;
      const proj = projectsById.get(pid);
      const limit = proj?.maxConcurrent;
      if (limit === undefined || limit === null) return true;
      return (runningPerProject[pid] ?? 0) < limit;
    });

    if (!first?.agentConfig) return null;

    return {
      workspaceId: first.workspace._id,
      issueId: first.workspace.issueId ?? undefined,
      projectId: first.workspace.projectId,
      agentConfig: first.agentConfig,
      repos: first.repos,
      issue: first.issue ?? undefined,
    };
  },
});

export const claim = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (workspace?.status !== "creating") return false;
    // Don't claim workspaces that are pending cancellation
    if (workspace.cancelRequested) return false;

    // Set status to "claimed" to prevent double-dispatch.
    // The lifecycle manages all subsequent transitions: claimed → coding → ...
    await ctx.db.patch(args.workspaceId, { status: "claimed" });

    // Capture sourceColumn and conditionally auto-move issue
    if (workspace.issueId && workspace.projectId) {
      const issue = await ctx.db.get(workspace.issueId);
      if (issue) {
        // Persist where the issue was when this workspace was claimed (debugging / history).
        if (!workspace.sourceColumn) {
          await ctx.db.patch(args.workspaceId, { sourceColumn: issue.status });
        }

        const project = await ctx.db.get(workspace.projectId);
        // When planning runs (skipPlanning === false), keep the issue in To Do until approvePlan moves it to In Progress.
        if (project?.skipPlanning !== false) {
          await autoMoveIssueToNextColumn(ctx, workspace.issueId, workspace.projectId, {
            onlyIfAutoDispatchColumn: true,
          });
        }
      }
    }

    return true;
  },
});

export const heartbeat = mutation({
  args: { activeCount: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workerState")
      .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastPollAt: Date.now(),
        activeCount: args.activeCount,
      });
    } else {
      await ctx.db.insert("workerState", {
        workerId: "default",
        lastPollAt: Date.now(),
        activeCount: args.activeCount,
      });
    }
  },
});

const WORKER_CONNECTED_THRESHOLD_MS = 30_000;

const RECENT_STATUSES = ["completed", "failed", "cancelled", "merged", "merge_failed", "conflict", "test_failed", "changes_requested"] as const;

export const status = query({
  args: {},
  handler: async (ctx) => {
    const [runningResults, queued, ...recentResults] = await Promise.all([
      Promise.all(
        RUNNING_STATUSES.map((s) =>
          ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", s)).collect()
        )
      ),
      ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", "creating")).collect(),
      ...RECENT_STATUSES.map((s) =>
        ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", s)).collect()
      ),
    ]);
    const running = runningResults.flat();
    const recent = recentResults.flat()
      .filter((w) => w.completedAt)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 10);

    // Worker health
    const workerState = await ctx.db
      .query("workerState")
      .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
      .unique();

    const lastPollAt = workerState?.lastPollAt ?? null;
    const workerConnected = lastPollAt !== null &&
      Date.now() - lastPollAt < WORKER_CONNECTED_THRESHOLD_MS;

    return {
      runningCount: running.length,
      queuedCount: queued.length,
      maxConcurrent: workerState?.maxConcurrentAgents ?? 3,
      lastPollAt,
      workerConnected,
      recentCompletions: recent.map((w) => ({
        workspaceId: w._id,
        status: w.status,
        finishedAt: w.completedAt ?? 0,
      })),
    };
  },
});

export const updateMaxConcurrent = mutation({
  args: { maxConcurrentAgents: v.number() },
  handler: async (ctx, args) => {
    if (args.maxConcurrentAgents < 1) throw new Error("maxConcurrentAgents must be >= 1");

    const existing = await ctx.db
      .query("workerState")
      .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        maxConcurrentAgents: args.maxConcurrentAgents,
      });
    } else {
      await ctx.db.insert("workerState", {
        workerId: "default",
        lastPollAt: 0,
        activeCount: 0,
        maxConcurrentAgents: args.maxConcurrentAgents,
      });
    }
  },
});

export const getMaxConcurrent = query({
  args: {},
  handler: async (ctx) => {
    const workerState = await ctx.db
      .query("workerState")
      .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
      .unique();
    return workerState?.maxConcurrentAgents ?? 3;
  },
});
