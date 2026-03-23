import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { assertAtLeastOneWhenNumber } from "./lib/concurrencyLimits";
import { autoMoveIssueToNextColumn, TERMINAL_COLUMN_NAMES } from "./workspaces";

const TERMINAL_STATUSES = TERMINAL_COLUMN_NAMES as readonly string[];
const RUNNING_STATUSES = ["claimed", "planning", "grilling", "coding", "testing", "reviewing", "rebasing"] as const;

/** Indices into `RUNNING_STATUSES` query batches (same order as `Promise.all` in `status`). */
const RUNNING_INDEX = Object.fromEntries(
  RUNNING_STATUSES.map((s, i) => [s, i]),
) as { [K in (typeof RUNNING_STATUSES)[number]]: number };

export type DispatchPhase = "planning" | "coding" | "testing" | "reviewing";

/** Convex validator for dispatch phase literals — reuse when adding args that name a lifecycle phase. */
export const dispatchPhaseArg = v.union(
  v.literal("planning"),
  v.literal("coding"),
  v.literal("testing"),
  v.literal("reviewing"),
);

/**
 * Returns whether global and per-project phase limits allow another workspace in the phase.
 * Unset limits mean no constraint for that dimension.
 */
export function phaseLimitsAllowEntry(
  countGlobal: number,
  countInProject: number,
  globalLimit: number | undefined,
  projectLimit: number | null | undefined,
): boolean {
  if (globalLimit !== undefined && countGlobal >= globalLimit) return false;
  if (projectLimit !== null && projectLimit !== undefined && countInProject >= projectLimit) {
    return false;
  }
  return true;
}

function globalPhaseLimit(
  workerState: Doc<"workerState"> | null | undefined,
  phase: DispatchPhase,
): number | undefined {
  if (!workerState) return undefined;
  switch (phase) {
    case "planning":
      return workerState.maxConcurrentPlanning;
    case "coding":
      return workerState.maxConcurrentCoding;
    case "testing":
      return workerState.maxConcurrentTesting;
    case "reviewing":
      return workerState.maxConcurrentReviewing;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

function projectPhaseLimit(
  project: Doc<"projects"> | null | undefined,
  phase: DispatchPhase,
): number | null | undefined {
  if (!project) return undefined;
  switch (phase) {
    case "planning":
      return project.maxConcurrentPlanning;
    case "coding":
      return project.maxConcurrentCoding;
    case "testing":
      return project.maxConcurrentTesting;
    case "reviewing":
      return project.maxConcurrentReviewing;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

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

/**
 * Whether this workspace may transition into `phase` given global + per-project limits.
 * Counts workspaces already in that status; **excludes** `workspaceId` so callers re-entering
 * the same phase (e.g. replanning) are not counted against themselves.
 * See SPEC §9.5 — concurrent waiters may briefly overshoot by one until the next check.
 */
export const canEnterPhase = query({
  args: {
    workspaceId: v.id("workspaces"),
    phase: dispatchPhaseArg,
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return false;

    let inPhase = await ctx.db
      .query("workspaces")
      .withIndex("by_status", (q) => q.eq("status", args.phase))
      .collect();
    if (args.phase === "planning") {
      const grilling = await ctx.db
        .query("workspaces")
        .withIndex("by_status", (q) => q.eq("status", "grilling"))
        .collect();
      inPhase = [...inPhase, ...grilling];
    }

    const countGlobal = inPhase.filter((w) => w._id !== args.workspaceId).length;
    const countInProject = inPhase.filter(
      (w) => w._id !== args.workspaceId && w.projectId === workspace.projectId,
    ).length;

    const workerState = await ctx.db
      .query("workerState")
      .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
      .unique();

    const project = await ctx.db.get(workspace.projectId);

    return phaseLimitsAllowEntry(
      countGlobal,
      countInProject,
      globalPhaseLimit(workerState, args.phase),
      projectPhaseLimit(project, args.phase),
    );
  },
});

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
    const [allRunning, workerState, ...projectDocs] = await Promise.all([
      Promise.all(
        RUNNING_STATUSES.map((s) =>
          ctx.db.query("workspaces").withIndex("by_status", (q) => q.eq("status", s)).collect()
        )
      ).then((results) => results.flat()),
      ctx.db
        .query("workerState")
        .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
        .unique(),
      ...projectIds.map((pid) => ctx.db.get(pid)),
    ]);

    const projectsById = new Map(projectIds.map((id, i) => [id, projectDocs[i]]));

    const runningPerProject: Record<string, number> = {};
    for (const ws of allRunning) {
      if (!ws.issueId) continue;
      const pid = ws.projectId;
      runningPerProject[pid] = (runningPerProject[pid] ?? 0) + 1;
    }

    // Dispatch candidates are always `status === "creating"`, so they are not in `allRunning` and
    // must not be subtracted here (unlike `canEnterPhase`, which excludes the current workspace row).
    const countInPhase = (phase: DispatchPhase) =>
      allRunning.filter((w) => w.status === phase || (phase === "planning" && w.status === "grilling")).length;
    const countInPhaseForProject = (phase: DispatchPhase, projectId: Id<"projects">) =>
      allRunning.filter(
        (w) =>
          w.projectId === projectId &&
          (w.status === phase || (phase === "planning" && w.status === "grilling")),
      ).length;

    const first = unblocked.find((candidate) => {
      const pid = candidate.workspace.projectId;
      const proj = projectsById.get(pid);
      const limit = proj?.maxConcurrent;
      if (limit !== undefined && limit !== null && (runningPerProject[pid] ?? 0) >= limit) {
        return false;
      }

      const initialPhase: DispatchPhase = proj?.skipPlanning === false ? "planning" : "coding";
      const cg = countInPhase(initialPhase);
      const cp = countInPhaseForProject(initialPhase, pid);
      if (
        !phaseLimitsAllowEntry(
          cg,
          cp,
          globalPhaseLimit(workerState, initialPhase),
          projectPhaseLimit(proj, initialPhase),
        )
      ) {
        return false;
      }

      return true;
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
      maxConcurrentPlanning: workerState?.maxConcurrentPlanning,
      maxConcurrentCoding: workerState?.maxConcurrentCoding,
      maxConcurrentTesting: workerState?.maxConcurrentTesting,
      maxConcurrentReviewing: workerState?.maxConcurrentReviewing,
      phaseCounts: {
        planning:
          (runningResults[RUNNING_INDEX.planning]?.length ?? 0) +
          (runningResults[RUNNING_INDEX.grilling]?.length ?? 0),
        coding: runningResults[RUNNING_INDEX.coding]?.length ?? 0,
        testing: runningResults[RUNNING_INDEX.testing]?.length ?? 0,
        reviewing: runningResults[RUNNING_INDEX.reviewing]?.length ?? 0,
      },
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

const PHASE_LIMIT_FIELDS = [
  "maxConcurrentPlanning",
  "maxConcurrentCoding",
  "maxConcurrentTesting",
  "maxConcurrentReviewing",
] as const;

/**
 * Updates concurrency settings with `db.patch` when possible so heartbeat (`lastPollAt` /
 * `activeCount`) is not overwritten. Clearing a phase limit (`null`) uses the same
 * get-and-replace pattern as `projects.update` for optional field deletion.
 */
export const updateMaxConcurrent = mutation({
  args: {
    maxConcurrentAgents: v.optional(v.number()),
    maxConcurrentPlanning: v.optional(v.union(v.number(), v.null())),
    maxConcurrentCoding: v.optional(v.union(v.number(), v.null())),
    maxConcurrentTesting: v.optional(v.union(v.number(), v.null())),
    maxConcurrentReviewing: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const hasUpdate =
      args.maxConcurrentAgents !== undefined ||
      PHASE_LIMIT_FIELDS.some((f) => args[f] !== undefined);
    if (!hasUpdate) throw new Error("At least one field is required");

    if (args.maxConcurrentAgents !== undefined && args.maxConcurrentAgents < 1) {
      throw new Error("maxConcurrentAgents must be >= 1");
    }

    for (const field of PHASE_LIMIT_FIELDS) {
      const val = args[field];
      if (typeof val === "number") assertAtLeastOneWhenNumber(field, val);
    }

    const existing = await ctx.db
      .query("workerState")
      .withIndex("by_workerId", (q) => q.eq("workerId", "default"))
      .unique();

    if (!existing) {
      await ctx.db.insert("workerState", {
        workerId: "default",
        lastPollAt: 0,
        activeCount: 0,
        maxConcurrentAgents: args.maxConcurrentAgents ?? 3,
        ...(args.maxConcurrentPlanning !== undefined && args.maxConcurrentPlanning !== null
          ? { maxConcurrentPlanning: args.maxConcurrentPlanning }
          : {}),
        ...(args.maxConcurrentCoding !== undefined && args.maxConcurrentCoding !== null
          ? { maxConcurrentCoding: args.maxConcurrentCoding }
          : {}),
        ...(args.maxConcurrentTesting !== undefined && args.maxConcurrentTesting !== null
          ? { maxConcurrentTesting: args.maxConcurrentTesting }
          : {}),
        ...(args.maxConcurrentReviewing !== undefined && args.maxConcurrentReviewing !== null
          ? { maxConcurrentReviewing: args.maxConcurrentReviewing }
          : {}),
      });
      return;
    }

    const patch: Record<string, unknown> = {};
    const fieldsToDelete: string[] = [];

    if (args.maxConcurrentAgents !== undefined) {
      patch["maxConcurrentAgents"] = args.maxConcurrentAgents;
    }

    for (const field of PHASE_LIMIT_FIELDS) {
      const val = args[field];
      if (val === undefined) continue;
      if (val === null) {
        fieldsToDelete.push(field);
      } else {
        patch[field] = val;
      }
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(existing._id, patch);
    }

    if (fieldsToDelete.length > 0) {
      const current = await ctx.db.get(existing._id);
      if (!current) return;
      const { _id, _creationTime, ...fields } = current;
      const mutable = fields as Record<string, unknown>;
      for (const key of fieldsToDelete) {
        mutable[key] = undefined;
      }
      await ctx.db.replace(existing._id, fields);
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
