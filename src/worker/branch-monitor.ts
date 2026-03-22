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
    if (!wt) continue;

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
