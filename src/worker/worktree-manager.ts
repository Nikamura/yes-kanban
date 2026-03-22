import { mkdir } from "fs/promises";
import { join } from "path";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ScriptLogger, WorktreeEntry } from "./types";
import { consumeStreamLines } from "./stream-lines";

const BRANCH_SAFE_RE = /[^A-Za-z0-9._\-/]/g;

function sanitizeBranch(name: string): string {
  return name.replace(BRANCH_SAFE_RE, "_");
}

export function slugifyTitle(title: string, maxLen = 50): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (slug.length > maxLen) {
    slug = slug.slice(0, maxLen).replace(/-[^-]*$/, "");
  }

  return slug;
}

/** Strip inherited GIT_* env vars so spawned git uses its own -C target repo. */
export function cleanGitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_INDEX_FILE"];
  env["GIT_EDITOR"] = "true";
  env["GIT_MERGE_AUTOEDIT"] = "no";
  return env;
}

export class GitWorktreeManager {
  constructor(private worktreeRoot: string) {}

  private async runScript(
    cmd: string,
    cwd: string,
    timeoutMs: number,
    logger?: ScriptLogger,
  ): Promise<{ exitCode: number; output: string }> {
    const proc = Bun.spawn(["sh", "-c", cmd], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const overallTimer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-proc.pid, "SIGTERM"); } catch { /* empty */ }
      try { proc.kill("SIGTERM"); } catch { /* empty */ }
    }, timeoutMs);

    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    await Promise.all([
      consumeStreamLines(proc.stdout, "stdout", {
        outParts: stdoutParts,
        onLine: logger ? (s, l) => logger.onLine(s, l) : undefined,
      }),
      consumeStreamLines(proc.stderr, "stderr", {
        outParts: stderrParts,
        onLine: logger ? (s, l) => logger.onLine(s, l) : undefined,
      }),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(overallTimer);
    const output = stdoutParts.join("") + stderrParts.join("");
    if (timedOut) {
      return { exitCode: -1, output: output + "\n[timeout]\n" };
    }
    return { exitCode, output };
  }

  async createWorktrees(args: {
    workspaceId: string;
    simpleId: string;
    issueTitle?: string;
    repos: Doc<"repos">[];
    logger?: ScriptLogger;
  }): Promise<{ worktrees: WorktreeEntry[]; agentCwd: string; resumed: boolean }> {
    const workspaceDir = join(this.worktreeRoot, args.workspaceId);
    await mkdir(workspaceDir, { recursive: true });

    const log = (msg: string) => console.log(`[worktree] workspace=${args.workspaceId} ${msg}`);

    const worktrees: WorktreeEntry[] = [];
    const createdPaths: string[] = [];
    let resumed = false;

    try {
      for (const repo of args.repos) {
        const titleSlug = args.issueTitle ? `-${slugifyTitle(args.issueTitle)}` : "";
        const branchName = sanitizeBranch(
          `yes-kanban/${args.simpleId}${titleSlug}`
        );
        const worktreePath =
          args.repos.length === 1
            ? workspaceDir
            : join(workspaceDir, repo.slug);

        log(`creating branch=${branchName} repo=${repo.path} base=${repo.defaultBranch} path=${worktreePath}`);

        // Try creating a fresh worktree with a new branch
        const result = Bun.spawnSync(
          [
            "git",
            "-C",
            repo.path,
            "worktree",
            "add",
            "-b",
            branchName,
            worktreePath,
            repo.defaultBranch,
          ],
          { timeout: 30000, env: cleanGitEnv() }
        );

        if (result.exitCode !== 0) {
          const stderr = result.stderr.toString();

          // Branch already exists — reuse it (preserves commits from previous attempt)
          if (stderr.includes("already exists")) {
            log(`branch ${branchName} already exists, resuming previous work`);

            // Remove any existing worktree that has this branch checked out
            this.removeWorktreeForBranch(repo.path, branchName, log);

            // Remove stale worktree ref at target path and leftover directory
            Bun.spawnSync(
              ["git", "-C", repo.path, "worktree", "remove", "--force", worktreePath],
              { timeout: 10000, env: cleanGitEnv() }
            );
            Bun.spawnSync(
              ["git", "-C", repo.path, "worktree", "prune"],
              { timeout: 10000, env: cleanGitEnv() }
            );
            // Remove leftover directory if worktree remove didn't clean it
            Bun.spawnSync(["rm", "-rf", worktreePath], { timeout: 10000 });

            const reuseResult = Bun.spawnSync(
              ["git", "-C", repo.path, "worktree", "add", worktreePath, branchName],
              { timeout: 30000, env: cleanGitEnv() }
            );

            if (reuseResult.exitCode !== 0) {
              throw new Error(
                `Failed to reuse existing branch: ${reuseResult.stderr.toString()}`
              );
            }
            resumed = true;
            log(`resumed existing branch ${branchName}`);
          } else {
            throw new Error(`Failed to create worktree: ${stderr}`);
          }
        } else {
          log(`created new branch ${branchName}`);
        }

        createdPaths.push(worktreePath);

        // Run setup script
        if (repo.setupScript) {
          log(`running setup script for repo=${repo.slug}`);
          if (args.logger) {
            args.logger.onLine("stdout", `--- [${repo.slug}] setup ---`);
          }
          const setupResult = await this.runScript(
            repo.setupScript,
            worktreePath,
            repo.scriptTimeoutMs,
            args.logger,
          );
          if (setupResult.exitCode !== 0) {
            throw new Error(
              `Setup script failed: ${setupResult.output.trim() || "(no output)"}`
            );
          }
          log(`setup script completed for repo=${repo.slug}`);
        }

        worktrees.push({
          repoId: repo._id,
          repoPath: repo.path,
          baseBranch: repo.defaultBranch,
          branchName,
          worktreePath,
        });
      }

      const firstWorktree = worktrees[0];
      if (!firstWorktree) throw new Error("No worktrees created");
      const agentCwd =
        args.repos.length === 1 ? firstWorktree.worktreePath : workspaceDir;

      log(`ready: ${worktrees.length} worktree(s), resumed=${resumed}, cwd=${agentCwd}`);
      return { worktrees, agentCwd, resumed };
    } catch (err) {
      log(`failed: ${err instanceof Error ? err.message : String(err)}`);
      // Cleanup on failure
      for (const path of createdPaths) {
        try {
          Bun.spawnSync(["git", "worktree", "remove", "--force", path], {
            timeout: 10000, env: cleanGitEnv(),
          });
        } catch { /* empty */ }
      }
      throw err;
    }
  }

  async removeWorktrees(args: {
    worktrees: WorktreeEntry[];
    repos: Doc<"repos">[];
    logger?: ScriptLogger;
  }): Promise<void> {
    for (const wt of args.worktrees) {
      const repo = args.repos.find((r) => r._id === wt.repoId);
      if (repo?.cleanupScript) {
        try {
          if (args.logger) {
            args.logger.onLine("stdout", `--- [${repo.slug}] cleanup ---`);
          }
          const { exitCode, output } = await this.runScript(
            repo.cleanupScript,
            wt.worktreePath,
            repo.scriptTimeoutMs,
            args.logger,
          );
          if (exitCode !== 0) {
            args.logger?.onLine(
              "stderr",
              `cleanup script exited with code ${exitCode}: ${output.trim().slice(0, 2000)}`,
            );
            console.warn(
              `[worktree-manager] cleanup script failed for ${wt.worktreePath}: exit ${exitCode}`,
            );
          }
        } catch (err) {
          console.warn(`[worktree-manager] cleanup script failed for ${wt.worktreePath}:`, err);
        }
      }
      try {
        const result = Bun.spawnSync(
          ["git", "-C", wt.repoPath, "worktree", "remove", "--force", wt.worktreePath],
          { timeout: 10000, env: cleanGitEnv() }
        );
        if (result.exitCode !== 0) {
          console.warn(`[worktree-manager] git worktree remove failed for ${wt.worktreePath}: ${result.stderr.toString().trim()}`);
        }
      } catch (err) {
        console.warn(`[worktree-manager] git worktree remove threw for ${wt.worktreePath}:`, err);
      }
      // Fallback: remove leftover directory if worktree remove didn't clean it
      try {
        Bun.spawnSync(["rm", "-rf", wt.worktreePath], { timeout: 10000 });
      } catch (err) {
        console.warn(`[worktree-manager] rm -rf failed for ${wt.worktreePath}:`, err);
      }

      // Clean up the feature branch now that the worktree is removed.
      // Uses -d (safe delete) which only works if the branch is fully merged.
      // Falls back to -D (force delete) if the branch exists but wasn't merged.
      try {
        const result = Bun.spawnSync(
          ["git", "-C", wt.repoPath, "branch", "-d", wt.branchName],
          { timeout: 10000, env: cleanGitEnv() }
        );
        if (result.exitCode !== 0) {
          const forceResult = Bun.spawnSync(
            ["git", "-C", wt.repoPath, "branch", "-D", wt.branchName],
            { timeout: 10000, env: cleanGitEnv() }
          );
          if (forceResult.exitCode !== 0) {
            console.warn(`[worktree-manager] branch delete failed for ${wt.branchName}: ${forceResult.stderr.toString().trim()}`);
          }
        }
      } catch (err) {
        console.warn(`[worktree-manager] branch delete threw for ${wt.branchName}:`, err);
      }
    }

    // Prune stale worktree references for each unique repo
    const uniqueRepoPaths = new Set(args.worktrees.map((wt) => wt.repoPath));
    for (const repoPath of uniqueRepoPaths) {
      try {
        Bun.spawnSync(
          ["git", "-C", repoPath, "worktree", "prune"],
          { timeout: 10000, env: cleanGitEnv() }
        );
      } catch (err) {
        console.warn(`[worktree-manager] worktree prune failed for ${repoPath}:`, err);
      }
    }
  }

  /**
   * Find and remove any existing worktree that has the given branch checked out.
   * This handles the case where a previous worktree at a different path still
   * holds a lock on the branch.
   */
  private removeWorktreeForBranch(
    repoPath: string,
    branchName: string,
    log: (msg: string) => void
  ): void {
    const listResult = Bun.spawnSync(
      ["git", "-C", repoPath, "worktree", "list", "--porcelain"],
      { timeout: 10000, env: cleanGitEnv() }
    );
    if (listResult.exitCode !== 0) return;

    const output = listResult.stdout.toString();
    const blocks = output.split("\n\n").filter(Boolean);

    for (const block of blocks) {
      const lines = block.split("\n");
      const worktreeLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!worktreeLine || !branchLine) continue;

      const wtPath = worktreeLine.slice("worktree ".length);
      const refBranch = branchLine.slice("branch refs/heads/".length);

      if (refBranch === branchName) {
        log(`removing stale worktree at ${wtPath} for branch ${branchName}`);
        Bun.spawnSync(
          ["git", "-C", repoPath, "worktree", "remove", "--force", wtPath],
          { timeout: 10000, env: cleanGitEnv() }
        );
        Bun.spawnSync(["rm", "-rf", wtPath], { timeout: 10000 });
      }
    }
  }

  /**
   * Find the merge-base between baseBranch and HEAD so diffs only show
   * changes introduced on the feature branch, not changes on baseBranch
   * that happened after the branch point.
   */
  private getMergeBase(worktreePath: string, baseBranch: string): string {
    const result = Bun.spawnSync(
      ["git", "-C", worktreePath, "merge-base", baseBranch, "HEAD"],
      { timeout: 10000, env: cleanGitEnv() }
    );
    const mergeBase = result.stdout.toString().trim();
    // Fall back to baseBranch if merge-base fails (e.g. unrelated histories)
    return mergeBase || baseBranch;
  }

  getFileTree(worktreePath: string): string[] {
    const result = Bun.spawnSync(
      ["git", "-C", worktreePath, "ls-files", "-co", "--exclude-standard"],
      { timeout: 30000, env: cleanGitEnv() }
    );
    return result.stdout
      .toString()
      .split("\n")
      .filter(Boolean);
  }

  getDiff(worktreePath: string, baseBranch: string): Promise<string> {
    const base = this.getMergeBase(worktreePath, baseBranch);
    const result = Bun.spawnSync(
      ["git", "-C", worktreePath, "diff", base],
      { timeout: 30000, env: cleanGitEnv() }
    );
    return Promise.resolve(result.stdout.toString());
  }

  getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]> {
    const base = this.getMergeBase(worktreePath, baseBranch);
    const result = Bun.spawnSync(
      ["git", "-C", worktreePath, "diff", "--name-only", base],
      { timeout: 10000, env: cleanGitEnv() }
    );
    return Promise.resolve(result.stdout
      .toString()
      .split("\n")
      .filter(Boolean));
  }
}
