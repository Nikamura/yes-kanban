import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { cleanGitEnv } from "./worktree-manager";

/**
 * Checks workspaces to see how many commits behind the base branch they are.
 * Updates the behindMainBy field in Convex.
 * Works with both remote (origin) and local-only repos.
 */
export async function checkBranchStatus(convex: ConvexClient): Promise<void> {
  const workspaces = await convex.query(api.workspaces.listForBranchCheck, {});

  for (const ws of workspaces) {
    const wt = ws.worktrees[0];
    if (!wt) continue;

    try {
      const env = cleanGitEnv();

      // Try fetching from origin (may fail for local-only repos — that's fine)
      Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "fetch", "origin"],
        { timeout: 30000, env },
      );

      // Check if origin/baseBranch exists
      const hasOrigin = Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "rev-parse", "--verify", `origin/${wt.baseBranch}`],
        { timeout: 5000, env },
      ).exitCode === 0;

      // Compare against origin/baseBranch if available, otherwise compare
      // against baseBranch in the main repo
      let behindRef: string;
      if (hasOrigin) {
        behindRef = `origin/${wt.baseBranch}`;
      } else {
        // For local-only repos, resolve the base branch from the main repo
        const baseRevResult = Bun.spawnSync(
          ["git", "-C", wt.repoPath, "rev-parse", wt.baseBranch],
          { timeout: 5000, env },
        );
        if (baseRevResult.exitCode !== 0) continue;
        behindRef = baseRevResult.stdout.toString().trim();
      }

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
