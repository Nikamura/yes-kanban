import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { performLocalMerge } from "./lifecycle";

describe("performLocalMerge", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore();
  });

  const wt = {
    worktreePath: "/tmp/wt",
    baseBranch: "main",
    branchName: "yes-kanban/proj/T-1",
    repoPath: "/tmp/repo",
    repoId: "repo1",
  } as any;

  test("succeeds with ff-only merge", () => {
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(true);
    // Should checkout base branch
    expect(calls.some(c => c.includes("checkout") && c.includes("main"))).toBe(true);
    // Should merge with --ff-only
    expect(calls.some(c => c.includes("merge") && c.includes("--ff-only"))).toBe(true);
    // Branch deletion is now handled by removeWorktrees, not performLocalMerge
    expect(calls.some(c => c.includes("branch") && c.includes("-d"))).toBe(false);
  });

  test("fails when checkout fails", () => {
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("checkout")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("error: pathspec") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("falls back to merge commit when ff-only fails", () => {
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      if (args.includes("merge") && args.includes("--ff-only")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("fatal: Not possible to fast-forward") } as any;
      }
      if (args.includes("merge-base")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt], false);

    expect(result.success).toBe(true);
    // Should have tried ff-only first, then fallen back to regular merge
    expect(calls.some(c => c.includes("merge") && c.includes("--ff-only"))).toBe(true);
    expect(calls.some(c => c.includes("merge") && c.includes("--no-edit"))).toBe(true);
  });

  test("fails when both ff-only and regular merge fail", () => {
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("merge") && !args.includes("--abort")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("CONFLICT (content)") } as any;
      }
      if (args.includes("merge-base")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("merge failed");
  });

  test("merges multiple worktrees independently", () => {
    const wt2 = {
      ...wt,
      repoPath: "/tmp/repo2",
      branchName: "yes-kanban/proj/T-2",
    };

    const mergedBranches: string[] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      if (args.includes("merge")) {
        const branchIdx = args.indexOf("--ff-only") + 1;
        if (branchIdx > 0 && args[branchIdx]) mergedBranches.push(args[branchIdx]);
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt, wt2]);

    expect(result.success).toBe(true);
    expect(mergedBranches).toEqual(["yes-kanban/proj/T-1", "yes-kanban/proj/T-2"]);
  });

  test("stops on first failure with multiple worktrees", () => {
    const wt2 = { ...wt, repoPath: "/tmp/repo2", branchName: "yes-kanban/proj/T-2" };
    const repoMergeAttempts = new Set<string>();

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      if (args.includes("merge") && !args.includes("--abort")) {
        // Track which repo we're merging in
        const cIdx = args.indexOf("-C");
        if (cIdx >= 0) repoMergeAttempts.add(args[cIdx + 1] ?? "");
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("CONFLICT") } as any;
      }
      if (args.includes("merge-base")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt, wt2]);

    expect(result.success).toBe(false);
    // Should only attempt merges on the first worktree's repo, not the second
    expect(repoMergeAttempts.has("/tmp/repo")).toBe(true);
    expect(repoMergeAttempts.has("/tmp/repo2")).toBe(false);
  });
});
