/**
 * Graceful restart handling for the worker process.
 *
 * When `bun run --watch` restarts the worker (e.g., after a local merge changes
 * files), in-progress workspaces should be re-queued for dispatch — not
 * permanently marked as failed.
 */

import type { Id } from "../../convex/_generated/dataModel";

/** Statuses that should be re-queued back to "creating" for full lifecycle. */
const REQUEUE_TO_CREATING = [
  "claimed",
  "planning",
  "grilling",
  "coding",
  "testing",
  "reviewing",
] as const;

/** Statuses that have their own poll handlers and should be preserved as-is. */
const PRESERVE_STATUSES = [
  "awaiting_feedback",
  "rebasing",
  "creating_pr",
  "merging",
] as const;

const IN_PROGRESS_STATUSES = [
  ...REQUEUE_TO_CREATING,
  ...PRESERVE_STATUSES,
] as const;

type InProgressStatus = (typeof IN_PROGRESS_STATUSES)[number];

interface WorkspaceLike {
  _id: Id<"workspaces">;
  status: string;
}

interface StatusUpdate {
  id: Id<"workspaces">;
  status: string;
}

/**
 * Check if a workspace status indicates it was in-progress and should be
 * re-queued on worker restart.
 */
export function shouldRequeueOnShutdown(status: string): status is InProgressStatus {
  return (IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

/**
 * Determine which workspaces need to be re-queued after a worker restart.
 * Returns status updates that reset in-progress workspaces to "creating"
 * so they'll be re-dispatched by the next poll cycle.
 *
 * This replaces the old behavior of permanently failing orphaned workspaces,
 * which wasted retry budgets when the worker was simply restarted (e.g., by
 * `--watch` after a local merge).
 */
export function recoverOrphanedWorkspaces(workspaces: WorkspaceLike[]): StatusUpdate[] {
  const updates: StatusUpdate[] = [];
  for (const ws of workspaces) {
    if (!shouldRequeueOnShutdown(ws.status)) continue;

    // Manual action statuses (rebasing, creating_pr, merging) have their own
    // poll handlers — preserve them so the correct handler picks them up.
    if ((PRESERVE_STATUSES as readonly string[]).includes(ws.status)) {
      // No status change needed — they'll be picked up by their existing handler.
      // Log for visibility but don't push an update.
      continue;
    }

    updates.push({ id: ws._id, status: "creating" });
  }
  return updates;
}
