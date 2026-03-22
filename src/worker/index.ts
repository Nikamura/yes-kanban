import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { runLifecycle, executeRebase, executeCreatePR, executeLocalMerge } from "./lifecycle";
import { GitWorktreeManager } from "./worktree-manager";
import { AgentExecutor } from "./agent-executor";
import type { WorkerConfig } from "./types";
import { isTerminalStatus } from "./retry";
import { sendHeartbeat } from "./heartbeat";
import { checkBranchStatus } from "./branch-monitor";
import { recoverOrphanedWorkspaces } from "./graceful-restart";
import { resolve } from "path";
import { readFileSync } from "fs";

const DEFAULT_CONFIG: WorkerConfig = {
  convexUrl: process.env["CONVEX_URL"] ?? "http://localhost:3210",
  maxConcurrentAgents: Number(process.env["MAX_CONCURRENT_AGENTS"] ?? 3),
  stallTimeoutMs: Number(process.env["STALL_TIMEOUT_MS"] ?? 300000),
  defaultAgentTimeoutMs: Number(process.env["AGENT_TIMEOUT_MS"] ?? 3600000),
  worktreeRoot: process.env["WORKTREE_ROOT"] ?? `${process.env["HOME"]}/.yes-kanban/worktrees`,
  pollIntervalMs: Number(process.env["POLL_INTERVAL_MS"] ?? 3000),
};

let running = true;
let shuttingDown = false;
let activeCount = 0;
const activeAbortControllers = new Map<string, AbortController>();

async function main() {
  const config = DEFAULT_CONFIG;
  console.log(`[worker] starting, convex=${config.convexUrl}, maxConcurrent=${config.maxConcurrentAgents}`);

  const convex = new ConvexClient(config.convexUrl);

  // Recover orphaned workspaces — re-queue them for dispatch instead of
  // permanently failing them. This handles both crashes and graceful restarts
  // (e.g., `--watch` restart after a local merge changes files).
  const active = await convex.query(api.workspaces.listActive, {});
  const orphanUpdates = recoverOrphanedWorkspaces(active);
  for (const update of orphanUpdates) {
    console.log(`[worker] re-queuing orphaned workspace=${update.id}`);
    // Mark any "running" run attempts as abandoned before re-queuing
    await convex.mutation(api.runAttempts.abandonRunning, {
      workspaceId: update.id,
    });
    await convex.mutation(api.workspaces.updateStatus, {
      id: update.id,
      status: update.status,
    });
  }

  // Immediate cleanup for merged workspaces that still have worktrees
  // (e.g., --watch restart killed the process before cleanup finished)
  try {
    const mergedWorkspaces = await convex.query(api.workspaces.listReadyForCleanup, {});
    for (const ws of mergedWorkspaces) {
      console.log(`[worker] startup cleanup: removing worktrees for merged workspace=${ws._id}`);
      const repos = await convex.query(api.repos.list, { projectId: ws.projectId });
      const worktreeManager = new GitWorktreeManager(config.worktreeRoot);
      await worktreeManager.removeWorktrees({ worktrees: ws.worktrees, repos });
      await convex.mutation(api.workspaces.clearWorktrees, { id: ws._id });
      await convex.mutation(api.fileContentRequests.deleteByWorkspace, { workspaceId: ws._id });
      console.log(`[worker] startup cleanup: worktrees cleaned for workspace=${ws._id}`);
    }
  } catch (err) {
    console.error("[worker] startup cleanup error:", err);
  }

  // Graceful shutdown — set shuttingDown so catch handlers re-queue
  // workspaces instead of permanently failing them.
  process.on("SIGINT", () => {
    console.log("[worker] shutting down...");
    shuttingDown = true;
    running = false;
    for (const [, ac] of activeAbortControllers) {
      ac.abort();
    }
  });
  process.on("SIGTERM", () => {
    shuttingDown = true;
    running = false;
    for (const [, ac] of activeAbortControllers) {
      ac.abort();
    }
  });

  // Branch monitor: check every ~60s (every 20th poll at 3s intervals)
  let branchCheckCounter = 0;
  const BRANCH_CHECK_INTERVAL = 20;

  // Poll loop
  while (running) {
    await sendHeartbeat(convex, activeCount);

    // Read dynamic maxConcurrentAgents from DB (default 3 on server side)
    const maxConcurrentAgents = await convex.query(api.dispatch.getMaxConcurrent, {});

    // Periodic branch status check
    branchCheckCounter++;
    if (branchCheckCounter >= BRANCH_CHECK_INTERVAL) {
      branchCheckCounter = 0;
      checkBranchStatus(convex).catch((err: unknown) => {
        console.error("[worker] branch check error:", err);
      });
    }

    // Check for cancel requests and abort running workspaces
    try {
      const allActive = await convex.query(api.workspaces.listActive, {});
      for (const ws of allActive) {
        if (!ws.cancelRequested) continue;
        const ac = activeAbortControllers.get(ws._id);
        if (ac) {
          console.log(`[worker] cancelling workspace=${ws._id} (cancelRequested=true)`);
          ac.abort();
          // Mark any running run attempts as abandoned
          await convex.mutation(api.runAttempts.abandonRunning, {
            workspaceId: ws._id,
          });
          // Mark as cancelled immediately — don't wait for the lifecycle to finish
          await convex.mutation(api.workspaces.updateStatus, {
            id: ws._id,
            status: "cancelled",
            completedAt: Date.now(),
          });
        } else if (["creating", "claimed", "planning", "awaiting_feedback", "coding", "testing", "reviewing", "rebasing", "creating_pr", "merging"].includes(ws.status)) {
          // Workspace has cancelRequested but no active controller — it may be
          // running in another worker or stuck. Mark it cancelled directly.
          console.log(`[worker] cancelling orphaned workspace=${ws._id} (no active controller)`);
          await convex.mutation(api.runAttempts.abandonRunning, {
            workspaceId: ws._id,
          });
          await convex.mutation(api.workspaces.updateStatus, {
            id: ws._id,
            status: "cancelled",
            completedAt: Date.now(),
          });
        }
      }
    } catch (err) {
      console.error("[worker] cancel check error:", err);
    }

    // Process manual rebase requests
    try {
      const rebasingWorkspaces = await convex.query(api.workspaces.listActive, {});
      for (const ws of rebasingWorkspaces) {
        if (ws.status !== "rebasing" || ws.worktrees.length === 0) continue;
        if (activeAbortControllers.has(ws._id)) continue; // already being processed

        console.log(`[worker] processing manual rebase for workspace=${ws._id}`);
        activeCount++;
        const abortController = new AbortController();
        activeAbortControllers.set(ws._id, abortController);

        const agentConfig = await convex.query(api.agentConfigs.get, { id: ws.agentConfigId });
        if (!agentConfig) {
          console.error(`[worker] no agent config for workspace=${ws._id}`);
          activeCount--;
          activeAbortControllers.delete(ws._id);
          continue;
        }

        const rebaseTpl = await convex.query(api.promptTemplates.resolve, {
          projectId: ws.projectId,
          type: "rebase",
        });
        const executor = new AgentExecutor();
        executeRebase(convex, config, executor, ws._id, agentConfig, ws.worktrees, abortController.signal, rebaseTpl?.content)
          .then(async (result) => {
            if (abortController.signal.aborted) return; // cancelled
            if (result === "success") {
              // Restore previous status after rebase (e.g. pr_open stays pr_open)
              // merge_failed should restore to completed — the rebase fixed the issue
              const prev = (ws as any).previousStatus;
              const restoreStatus = (!prev || prev === "merge_failed") ? "completed" : prev;
              await convex.mutation(api.workspaces.updateStatus, {
                id: ws._id,
                status: restoreStatus,
                skipAutoMove: true,
              });
              await convex.mutation(api.workspaces.updateBranchStatus, {
                id: ws._id,
                behindMainBy: 0,
              });
              console.log(`[worker] rebase succeeded for workspace=${ws._id}`);
            } else {
              await convex.mutation(api.workspaces.updateStatus, {
                id: ws._id,
                status: "conflict",
              });
              console.log(`[worker] rebase failed (conflict) for workspace=${ws._id}`);
            }
          })
          .catch(async (err: unknown) => {
            if (abortController.signal.aborted) return; // cancelled
            console.error(`[worker] rebase error for workspace=${ws._id}:`, err);
            await convex.mutation(api.workspaces.updateStatus, {
              id: ws._id,
              status: "conflict",
            }).catch(() => {});
          })
          .finally(() => {
            activeCount--;
            activeAbortControllers.delete(ws._id);
          });
      }
    } catch (err) {
      console.error("[worker] rebase poll error:", err);
    }

    // Process manual PR creation and local merge requests
    try {
      const pendingActions = await convex.query(api.workspaces.listPendingActions, {});
      for (const ws of pendingActions) {
        if (ws.worktrees.length === 0) continue;
        // Skip if cancel was requested
        if (ws.cancelRequested) continue;

        if (ws.status === "creating_pr") {
          console.log(`[worker] creating PR for workspace=${ws._id}`);
          // Look up issue for title/body
          let issue: { title: string; description: string } | null = null;
          if (ws.issueId) {
            const issueDoc = await convex.query(api.issues.get, { id: ws.issueId });
            if (issueDoc) issue = { title: issueDoc.title, description: issueDoc.description };
          }
          const result = await executeCreatePR(ws._id, ws.worktrees, issue);
          if (result === "success") {
            await convex.mutation(api.workspaces.updateStatus, {
              id: ws._id, status: "pr_open",
            });
            console.log(`[worker] PR created for workspace=${ws._id}`);
          } else {
            // Revert to completed so user can retry
            await convex.mutation(api.workspaces.updateStatus, {
              id: ws._id, status: "completed",
            });
            console.error(`[worker] PR creation failed for workspace=${ws._id}, reverted to completed`);
          }
        }

        if (ws.status === "merging") {
          const wt = ws.worktrees[0];
          console.log(`[worker] performing local merge for workspace=${ws._id} branch=${wt?.branchName} into=${wt?.baseBranch}`);
          const result = executeLocalMerge(ws.worktrees);
          if (result.success) {
            await convex.mutation(api.workspaces.updateStatus, {
              id: ws._id, status: "merged", completedAt: Date.now(),
            });
            console.log(`[worker] local merge succeeded for workspace=${ws._id}`);

            // Clean up worktrees immediately after merge
            try {
              const repos = await convex.query(api.repos.list, { projectId: ws.projectId });
              const worktreeManager = new GitWorktreeManager(config.worktreeRoot);
              await worktreeManager.removeWorktrees({ worktrees: ws.worktrees, repos });
              await convex.mutation(api.workspaces.clearWorktrees, { id: ws._id });
              await convex.mutation(api.fileContentRequests.deleteByWorkspace, { workspaceId: ws._id });
              console.log(`[worker] worktrees cleaned up for workspace=${ws._id}`);
            } catch (cleanupErr) {
              console.error(`[worker] worktree cleanup failed for workspace=${ws._id}:`, cleanupErr);
            }
          } else {
            await convex.mutation(api.workspaces.updateStatus, {
              id: ws._id, status: "merge_failed", lastError: result.error,
            });
            console.error(`[worker] local merge failed for workspace=${ws._id} branch=${wt?.branchName}: ${result.error}`);
          }
        }
      }
    } catch (err) {
      console.error("[worker] pending actions poll error:", err);
    }

    // Fulfill file content requests (for browsing unmodified files in diff view)
    try {
      const pendingFileRequests = await convex.query(api.fileContentRequests.listPending, {});
      for (const req of pendingFileRequests) {
        try {
          const ws = await convex.query(api.workspaces.get, { id: req.workspaceId });
          if (!ws || ws.worktrees.length === 0) {
            await convex.mutation(api.fileContentRequests.fulfill, {
              id: req._id,
              status: "error",
              error: "Worktree no longer available",
            });
            continue;
          }

          const firstWt = ws.worktrees[0];
          if (!firstWt) {
            await convex.mutation(api.fileContentRequests.fulfill, {
              id: req._id, status: "error", error: "No worktree available",
            });
            continue;
          }

          // Path traversal guard
          const resolvedPath = resolve(firstWt.worktreePath, req.filePath);
          if (!resolvedPath.startsWith(resolve(firstWt.worktreePath) + "/")) {
            await convex.mutation(api.fileContentRequests.fulfill, {
              id: req._id, status: "error", error: "Invalid file path",
            });
            continue;
          }

          // Read file
          const MAX_FILE_SIZE = 512 * 1024; // 512KB
          let buffer: Buffer;
          try {
            buffer = readFileSync(resolvedPath);
          } catch {
            await convex.mutation(api.fileContentRequests.fulfill, {
              id: req._id, status: "error", error: "File not found",
            });
            continue;
          }

          // Size check
          if (buffer.length > MAX_FILE_SIZE) {
            await convex.mutation(api.fileContentRequests.fulfill, {
              id: req._id, status: "error",
              error: `File too large (${Math.round(buffer.length / 1024)}KB)`,
              fileSize: buffer.length,
            });
            continue;
          }

          // Binary detection (null bytes in first 8KB)
          const checkSlice = buffer.subarray(0, 8192);
          if (checkSlice.includes(0)) {
            await convex.mutation(api.fileContentRequests.fulfill, {
              id: req._id, status: "fulfilled",
              isBinary: true, fileSize: buffer.length,
            });
            continue;
          }

          await convex.mutation(api.fileContentRequests.fulfill, {
            id: req._id, status: "fulfilled",
            content: buffer.toString("utf-8"),
            fileSize: buffer.length,
          });
        } catch (err) {
          console.error(`[worker] file content request error for ${req.filePath}:`, err);
          await convex.mutation(api.fileContentRequests.fulfill, {
            id: req._id, status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[worker] file content poll error:", err);
    }

    if (activeCount < maxConcurrentAgents) {
      try {
        const task = await convex.query(api.dispatch.next, {});
        if (task?.agentConfig) {
          console.log(`[worker] dispatching workspace=${task.workspaceId} issue=${task.issue?.simpleId ?? "none"} agent=${task.agentConfig.name}`);
          const claimed = await convex.mutation(api.dispatch.claim, {
            workspaceId: task.workspaceId,
          });
          if (claimed) {
            console.log(`[worker] claimed workspace=${task.workspaceId} (active=${activeCount + 1}/${maxConcurrentAgents})`);
            activeCount++;
            const abortController = new AbortController();
            activeAbortControllers.set(task.workspaceId, abortController);
            runLifecycle(convex, config, task, abortController.signal)
              .catch(async (err: unknown) => {
                // Don't overwrite cancelled status with failed
                if (abortController.signal.aborted) {
                  console.log(`[worker] workspace=${task.workspaceId} lifecycle ended (cancelled)`);
                  return;
                }
                console.error(`[worker] workspace=${task.workspaceId} lifecycle error:`, err);
                try {
                  if (shuttingDown) {
                    // Worker is restarting (e.g., --watch triggered by local merge).
                    // Re-queue the workspace so it gets re-dispatched on next startup.
                    // Note: this is best-effort — if the convex client is already closed,
                    // the startup recovery in main() will catch it on next boot.
                    await convex.mutation(api.workspaces.updateStatus, {
                      id: task.workspaceId,
                      status: "creating",
                    });
                    console.log(`[worker] workspace=${task.workspaceId} re-queued for restart`);
                  } else {
                    // Actual error — mark as failed so it doesn't get stuck
                    await convex.mutation(api.workspaces.updateStatus, {
                      id: task.workspaceId,
                      status: "failed",
                      completedAt: Date.now(),
                    });
                    console.log(`[worker] workspace=${task.workspaceId} marked as failed`);
                  }
                } catch { /* best effort */ }
              })
              .finally(() => {
                activeCount--;
                console.log(`[worker] workspace=${task.workspaceId} finished (active=${activeCount}/${maxConcurrentAgents})`);
                activeAbortControllers.delete(task.workspaceId);
              });
          }
        }
      } catch (err) {
        console.error("[worker] poll error:", err);
      }
    }

    // Process due retries
    if (activeCount < maxConcurrentAgents) {
      try {
        const dueRetries = await convex.query(api.retries.pending, { now: Date.now() });
        for (const retry of dueRetries) {
          if (!retry || activeCount >= maxConcurrentAgents) break;

          const { issue, agentConfig } = retry;

          // If issue is in a terminal column, abandon the retry
          if (issue && isTerminalStatus(issue.status)) {
            await convex.mutation(api.retries.abandon, { id: retry._id });
            console.log(`[worker] abandoned retry for workspace=${retry.workspaceId}, issue in terminal status=${issue.status}`);
            continue;
          }

          if (!agentConfig) {
            await convex.mutation(api.retries.abandon, { id: retry._id });
            console.log(`[worker] abandoned retry for workspace=${retry.workspaceId}, agent config missing`);
            continue;
          }

          // Mark retry as dispatched and reset workspace for re-dispatch
          await convex.mutation(api.retries.markDispatched, { id: retry._id });
          // Clean up any orphaned "running" run attempts from the failed run
          await convex.mutation(api.runAttempts.abandonRunning, {
            workspaceId: retry.workspaceId,
          });
          await convex.mutation(api.workspaces.updateStatus, {
            id: retry.workspaceId,
            status: "creating",
          });

          console.log(`[worker] re-dispatching retry #${retry.attemptNumber} for workspace=${retry.workspaceId}`);
        }
      } catch (err) {
        console.error("[worker] retry poll error:", err);
      }
    }

    // Clean up worktrees for merged/cancelled workspaces after delay
    try {
      const cleanupWorkspaces = await convex.query(api.workspaces.listReadyForCleanup, {});
      for (const ws of cleanupWorkspaces) {
        // Merged workspaces clean up immediately; cancelled ones respect the delay
        if (ws.status !== "merged" && ws.completedAt) {
          const project = await convex.query(api.projects.get, { id: ws.projectId });
          const delay = project?.cleanupDelayMs ?? 3600000; // default 1 hour
          if (Date.now() - ws.completedAt < delay) continue;
        }

        console.log(`[worker] cleaning up worktrees for ${ws.status} workspace=${ws._id}`);
        const repos = await convex.query(api.repos.list, { projectId: ws.projectId });
        const worktreeManager = new GitWorktreeManager(config.worktreeRoot);
        await worktreeManager.removeWorktrees({ worktrees: ws.worktrees, repos });
        await convex.mutation(api.workspaces.clearWorktrees, { id: ws._id });
        await convex.mutation(api.fileContentRequests.deleteByWorkspace, { workspaceId: ws._id });
        console.log(`[worker] worktrees cleaned up for workspace=${ws._id}`);
      }
    } catch (err) {
      console.error("[worker] cleanup poll error:", err);
    }

    await Bun.sleep(config.pollIntervalMs);
  }

  // Wait for active tasks to finish
  while (activeCount > 0) {
    await Bun.sleep(1000);
  }
  console.log("[worker] shutdown complete");
  process.exit(0);
}

void main();
