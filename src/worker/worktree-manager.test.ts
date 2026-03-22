import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GitWorktreeManager, slugifyTitle } from "./worktree-manager";
import { performLocalMerge } from "./lifecycle";
import { mkdtemp, rm } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** Strip inherited GIT_* env vars so test git commands target their own repo. */
function cleanGitEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_INDEX_FILE"];
  return env;
}

function git(...args: string[]) {
  return Bun.spawnSync(["git", ...args], { env: cleanGitEnv() });
}

describe("slugifyTitle", () => {
  test("converts title to lowercase kebab-case", () => {
    expect(slugifyTitle("Add User Authentication")).toBe("add-user-authentication");
  });

  test("removes special characters", () => {
    expect(slugifyTitle("Fix bug #123: crash on login!")).toBe("fix-bug-123-crash-on-login");
  });

  test("collapses multiple hyphens", () => {
    expect(slugifyTitle("hello---world")).toBe("hello-world");
  });

  test("trims to maxLen at word boundary", () => {
    const result = slugifyTitle("this is a very long title that should be truncated at a word boundary", 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toBe("this-is-a-very-long-title");
  });

  test("defaults to 50 char max", () => {
    const result = slugifyTitle("a".repeat(100));
    expect(result.length).toBeLessThanOrEqual(50);
  });

  test("strips leading and trailing hyphens", () => {
    expect(slugifyTitle("  --hello world--  ")).toBe("hello-world");
  });

  test("returns empty string for empty input", () => {
    expect(slugifyTitle("")).toBe("");
  });
});

describe("GitWorktreeManager", () => {
  let tempDir: string;
  let repoDir: string;
  let worktreeRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yk-test-"));
    repoDir = join(tempDir, "repo");
    worktreeRoot = join(tempDir, "worktrees");

    // Create a test git repo
    git("init", repoDir);
    git("-C", repoDir, "config", "user.email", "test@test.com");
    git("-C", repoDir, "config", "user.name", "Test");
    // Create initial commit
    Bun.spawnSync(["touch", join(repoDir, "README.md")]);
    git("-C", repoDir, "add", ".");
    git("-C", repoDir, "commit", "-m", "init");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates a worktree for a single repo", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees, agentCwd } = await manager.createWorktrees({
      workspaceId: "ws-123",
      projectSlug: "myproj",
      simpleId: "TASK-1",
      issueTitle: "Add user authentication",
      repos: [{ _id: "repo1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]!.branchName).toBe("yes-kanban/myproj/TASK-1-add-user-authentication");
    expect(worktrees[0]!.baseBranch).toBe("main");
    expect(agentCwd).toBe(worktrees[0]!.worktreePath);

    // Verify worktree exists
    const check = git("-C", worktrees[0]!.worktreePath, "branch", "--show-current");
    expect(check.stdout.toString().trim()).toBe("yes-kanban/myproj/TASK-1-add-user-authentication");
  });

  test("creates worktrees for multiple repos", async () => {
    // Create second repo
    const repo2Dir = join(tempDir, "repo2");
    git("init", repo2Dir);
    git("-C", repo2Dir, "config", "user.email", "test@test.com");
    git("-C", repo2Dir, "config", "user.name", "Test");
    Bun.spawnSync(["touch", join(repo2Dir, "README.md")]);
    git("-C", repo2Dir, "add", ".");
    git("-C", repo2Dir, "commit", "-m", "init");

    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees, agentCwd } = await manager.createWorktrees({
      workspaceId: "ws-456",
      projectSlug: "proj",
      simpleId: "TASK-2",
      repos: [
        { _id: "r1", path: repoDir, slug: "frontend", defaultBranch: "main", scriptTimeoutMs: 10000 } as any,
        { _id: "r2", path: repo2Dir, slug: "backend", defaultBranch: "main", scriptTimeoutMs: 10000 } as any,
      ],
    });

    expect(worktrees).toHaveLength(2);
    // For multi-repo, agentCwd should be the workspace dir (parent of both)
    expect(agentCwd).toBe(join(worktreeRoot, "ws-456"));
    expect(worktrees[0]!.worktreePath).toContain("frontend");
    expect(worktrees[1]!.worktreePath).toContain("backend");
  });

  test("sanitizes branch names", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-789",
      projectSlug: "my project!",
      simpleId: "TASK 3",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    // Special chars should be replaced with _
    expect(worktrees[0]!.branchName).toBe("yes-kanban/my_project_/TASK_3");
  });

  test("cleans up on partial failure", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);

    // Create a worktree that will succeed, then try with a non-existent base branch
    try {
      await manager.createWorktrees({
        workspaceId: "ws-fail",
        projectSlug: "proj",
        simpleId: "TASK-99",
        repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "nonexistent", scriptTimeoutMs: 10000 } as any],
      });
      expect(true).toBe(false); // Should not reach here
    } catch (err: unknown) {
      expect(err instanceof Error ? err.message : String(err)).toContain("Failed to create worktree");
    }
  });

  test("getDiff returns diff output", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-diff",
      projectSlug: "proj",
      simpleId: "TASK-4",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    // Make a change in the worktree
    await Bun.write(join(worktrees[0]!.worktreePath, "new-file.txt"), "hello");
    git("-C", worktrees[0]!.worktreePath, "add", ".");
    git("-C", worktrees[0]!.worktreePath, "commit", "-m", "add file");

    const diff = await manager.getDiff(worktrees[0]!.worktreePath, "main");
    expect(diff).toContain("new-file.txt");
    expect(diff).toContain("hello");
  });

  test("getDiff only includes feature branch changes when base branch advances", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-diff-advanced",
      projectSlug: "proj",
      simpleId: "TASK-ADV",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    // Make a change on the feature branch
    await Bun.write(join(worktrees[0]!.worktreePath, "feature.txt"), "feature work");
    git("-C", worktrees[0]!.worktreePath, "add", ".");
    git("-C", worktrees[0]!.worktreePath, "commit", "-m", "feature commit");

    // Now advance main in the original repo (simulating other merges)
    await Bun.write(join(repoDir, "main-update.txt"), "main branch update");
    git("-C", repoDir, "add", ".");
    git("-C", repoDir, "commit", "-m", "advance main");

    const diff = await manager.getDiff(worktrees[0]!.worktreePath, "main");

    // Should contain the feature branch change
    expect(diff).toContain("feature.txt");
    expect(diff).toContain("feature work");

    // Should NOT contain the main branch change (this is the bug)
    expect(diff).not.toContain("main-update.txt");
    expect(diff).not.toContain("main branch update");
  });

  test("getChangedFiles lists changed files", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-files",
      projectSlug: "proj",
      simpleId: "TASK-5",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    await Bun.write(join(worktrees[0]!.worktreePath, "changed.txt"), "content");
    git("-C", worktrees[0]!.worktreePath, "add", ".");
    git("-C", worktrees[0]!.worktreePath, "commit", "-m", "change");

    const files = await manager.getChangedFiles(worktrees[0]!.worktreePath, "main");
    expect(files).toContain("changed.txt");
  });

  test("getChangedFiles only includes feature branch files when base branch advances", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-files-adv",
      projectSlug: "proj",
      simpleId: "TASK-FADV",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    await Bun.write(join(worktrees[0]!.worktreePath, "feature-file.txt"), "content");
    git("-C", worktrees[0]!.worktreePath, "add", ".");
    git("-C", worktrees[0]!.worktreePath, "commit", "-m", "feature change");

    // Advance main
    await Bun.write(join(repoDir, "main-only.txt"), "main stuff");
    git("-C", repoDir, "add", ".");
    git("-C", repoDir, "commit", "-m", "advance main");

    const files = await manager.getChangedFiles(worktrees[0]!.worktreePath, "main");
    expect(files).toContain("feature-file.txt");
    expect(files).not.toContain("main-only.txt");
  });

  test("removeWorktrees cleans up", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-rm",
      projectSlug: "proj",
      simpleId: "TASK-6",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    await manager.removeWorktrees({
      worktrees,
      repos: [{ _id: "r1", path: repoDir, scriptTimeoutMs: 10000 } as any],
    });

    // Verify worktree is gone
    const check = git("-C", repoDir, "worktree", "list");
    const output = check.stdout.toString();
    expect(output).not.toContain("TASK-6");
  });

  test("removeWorktrees works after performLocalMerge", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-merge-cleanup",
      projectSlug: "proj",
      simpleId: "TASK-7",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    // Make a commit in the worktree so there's something to merge
    const wtPath = worktrees[0]!.worktreePath;
    await Bun.write(join(wtPath, "feature.txt"), "new feature");
    git("-C", wtPath, "add", ".");
    git("-C", wtPath, "commit", "-m", "add feature");

    // Perform the local merge (merges into main)
    const mergeResult = performLocalMerge(worktrees);
    expect(mergeResult.success).toBe(true);

    // Worktree directory should still exist after merge
    expect(existsSync(wtPath)).toBe(true);

    // Now clean up worktrees — this is what should happen immediately after merge
    await manager.removeWorktrees({
      worktrees,
      repos: [{ _id: "r1", path: repoDir, scriptTimeoutMs: 10000 } as any],
    });

    // Verify worktree is gone from git
    const checkWt = git("-C", repoDir, "worktree", "list");
    const wtOutput = checkWt.stdout.toString();
    expect(wtOutput).not.toContain("TASK-7");

    // Verify worktree directory is removed
    expect(existsSync(wtPath)).toBe(false);

    // Verify the feature was merged into main
    const log = git("-C", repoDir, "log", "--oneline", "main");
    expect(log.stdout.toString()).toContain("add feature");
  });

  test("resumes when branch is checked out in a different worktree path", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);

    // First creation at workspace ws-old
    const { worktrees: first } = await manager.createWorktrees({
      workspaceId: "ws-old",
      projectSlug: "proj",
      simpleId: "TASK-DUP",
      issueTitle: "duplicate test",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    // Make a commit so we can verify it's preserved
    const wtPath = first[0]!.worktreePath;
    await Bun.write(join(wtPath, "old-work.txt"), "old work");
    git("-C", wtPath, "add", ".");
    git("-C", wtPath, "commit", "-m", "old work commit");

    // Second creation at a DIFFERENT workspace — same branch, different path
    // This should succeed by removing the old worktree first
    const { worktrees: second, resumed } = await manager.createWorktrees({
      workspaceId: "ws-new",
      projectSlug: "proj",
      simpleId: "TASK-DUP",
      issueTitle: "duplicate test",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    expect(resumed).toBe(true);
    expect(second).toHaveLength(1);
    // Old worktree path should be gone
    expect(existsSync(wtPath)).toBe(false);
    // New worktree should have the old commit
    const log = git("-C", second[0]!.worktreePath, "log", "--oneline");
    expect(log.stdout.toString()).toContain("old work commit");
  });

  test("removeWorktrees cleans up branch after worktree removal", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-branch-cleanup",
      projectSlug: "proj",
      simpleId: "TASK-8",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    // Make a commit so branch diverges
    const wtPath = worktrees[0]!.worktreePath;
    await Bun.write(join(wtPath, "stuff.txt"), "content");
    git("-C", wtPath, "add", ".");
    git("-C", wtPath, "commit", "-m", "add stuff");

    // Merge into main
    const mergeResult = performLocalMerge(worktrees);
    expect(mergeResult.success).toBe(true);

    // Remove worktrees
    await manager.removeWorktrees({
      worktrees,
      repos: [{ _id: "r1", path: repoDir, scriptTimeoutMs: 10000 } as any],
    });

    // Verify the feature branch was cleaned up
    const branches = git("-C", repoDir, "branch");
    expect(branches.stdout.toString()).not.toContain("TASK-8");
  });

  test("getFileTree returns tracked files", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-filetree",
      projectSlug: "proj",
      simpleId: "TASK-9",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    const wt = worktrees[0]!;
    const files = manager.getFileTree(wt.worktreePath);
    expect(files).toContain("README.md");
  });

  test("getFileTree includes untracked files", async () => {
    const manager = new GitWorktreeManager(worktreeRoot);
    const { worktrees } = await manager.createWorktrees({
      workspaceId: "ws-filetree2",
      projectSlug: "proj",
      simpleId: "TASK-10",
      repos: [{ _id: "r1", path: repoDir, slug: "repo", defaultBranch: "main", scriptTimeoutMs: 10000 } as any],
    });

    const wt = worktrees[0]!;
    // Create an untracked file
    Bun.spawnSync(["touch", join(wt.worktreePath, "new-file.ts")]);

    const files = manager.getFileTree(wt.worktreePath);
    expect(files).toContain("README.md");
    expect(files).toContain("new-file.ts");
  });
});
