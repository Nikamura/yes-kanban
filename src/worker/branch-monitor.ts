import { existsSync } from "node:fs";
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { cleanGitEnv } from "./worktree-manager";

/**
 * Checks workspaces to see how many commits behind the base branch they are.
 * Updates the behindMainBy field in Convex.
 * Compares against the local base branch in the main repo (what local merge targets).
 */
export async function checkBranchStatus(convex: ConvexClient): Promise<void> {
  const workspaces = await convex.query(api.workspaces.listForBranchCheck, {});

  for (const ws of workspaces) {
    const wt = ws.worktrees[0];
    if (!wt || !existsSync(wt.repoPath)) continue;

    try {
      const env = cleanGitEnv();

      // Resolve base branch from the main repo — this is what local merge
      // targets, so behind count must match what the merge will see
      const baseRevResult = Bun.spawnSync(
        ["git", "-C", wt.repoPath, "rev-parse", wt.baseBranch],
        { timeout: 5000, env },
      );
      if (baseRevResult.exitCode !== 0) continue;
      const behindRef = baseRevResult.stdout.toString().trim();

      // Count commits behind
      const result = Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "rev-list", "--count", `HEAD..${behindRef}`],
        { timeout: 10000, env },
      );

      const behindBy = parseInt(result.stdout.toString().trim(), 10);
      if (!isNaN(behindBy) && behindBy !== (ws.behindMainBy ?? 0)) {
        await convex.mutation(api.workspaces.updateBranchStatus, {
          id: ws._id,
          behindMainBy: behindBy,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[branch-monitor] failed to check workspace=${ws._id}:`, message);
    }
  }
}

/**
 * Fast-forward local base branches from origin for repos that have active worktrees.
 * Uses pull when the base branch is checked out, otherwise fetch refspec.
 * Considers every worktree entry so multi-repo workspaces update each base branch.
 */
export async function pullBaseBranches(convex: ConvexClient): Promise<void> {
  const workspaces = await convex.query(api.workspaces.listForBranchCheck, {});
  const seen = new Set<string>();

  for (const ws of workspaces) {
    for (const wt of ws.worktrees) {
      if (!existsSync(wt.repoPath)) continue;
      const key = `${wt.repoPath}:${wt.baseBranch}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const env = cleanGitEnv();

        const headResult = Bun.spawnSync(
          ["git", "-C", wt.repoPath, "symbolic-ref", "--short", "HEAD"],
          { timeout: 5000, env },
        );
        const currentBranch = headResult.exitCode === 0
          ? headResult.stdout.toString().trim()
          : null;

        if (currentBranch === wt.baseBranch) {
          const result = Bun.spawnSync(
            ["git", "-C", wt.repoPath, "pull", "--ff-only", "origin", wt.baseBranch],
            { timeout: 60000, env },
          );
          if (result.exitCode !== 0) {
            const err = result.stderr.toString().trim();
            if (!err.includes("Not possible to fast-forward")) {
              console.warn(`[branch-monitor] pull ${wt.baseBranch} failed for ${wt.repoPath}: ${err}`);
            }
          }
        } else {
          const result = Bun.spawnSync(
            ["git", "-C", wt.repoPath, "fetch", "origin", `${wt.baseBranch}:${wt.baseBranch}`],
            { timeout: 60000, env },
          );
          if (result.exitCode !== 0) {
            const err = result.stderr.toString().trim();
            if (!err.includes("non-fast-forward")) {
              console.warn(`[branch-monitor] fetch ${wt.baseBranch} failed for ${wt.repoPath}: ${err}`);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[branch-monitor] pull failed for ${wt.repoPath}:`, message);
      }
    }
  }
}
