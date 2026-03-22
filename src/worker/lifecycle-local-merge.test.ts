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

  test("succeeds with squash merge", () => {
    const calls: string[][] = [];
    let commitMessage: string | undefined;

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);

      if (args.includes("commit") && args.includes("-m")) {
        const mIdx = args.indexOf("-m");
        commitMessage = args[mIdx + 1];
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      if (args.includes("diff") && args.includes("--cached") && args.includes("--quiet")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      if (args.includes("log") && args.includes("--pretty=format:%s")) {
        return {
          exitCode: 0,
          stdout: Buffer.from("first change\nsecond change"),
          stderr: Buffer.from(""),
        } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(true);
    expect(calls.some(c => c.includes("checkout") && c.includes("main"))).toBe(true);
    expect(calls.some(c => c.includes("merge") && c.includes("--squash") && c.includes("yes-kanban/proj/T-1"))).toBe(
      true,
    );
    expect(calls.some(c => c.includes("log") && c.includes("main..yes-kanban/proj/T-1"))).toBe(true);
    expect(commitMessage).toBe("first change\n\nsecond change\n\nGenerated-by: Yes Kanban");
    expect(calls.some(c => c.includes("branch") && c.includes("-d"))).toBe(false);
  });

  test("single commit branch includes trailer", () => {
    let commitMessage: string | undefined;

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      if (args.includes("commit") && args.includes("-m")) {
        const mIdx = args.indexOf("-m");
        commitMessage = args[mIdx + 1];
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      if (args.includes("diff") && args.includes("--cached") && args.includes("--quiet")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      if (args.includes("log") && args.includes("--pretty=format:%s")) {
        return { exitCode: 0, stdout: Buffer.from("only change"), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(true);
    expect(commitMessage).toBe("only change\n\nGenerated-by: Yes Kanban");
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

  test("cleans up on squash merge failure", () => {
    const calls: string[][] = [];

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      if (args.includes("merge") && args.includes("--squash")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("CONFLICT") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("squash merge failed");
    const squashIdx = calls.findIndex(c => c.includes("merge") && c.includes("--squash"));
    expect(squashIdx).toBeGreaterThanOrEqual(0);
    const afterSquash = calls.slice(squashIdx + 1);
    expect(afterSquash.some(c => c.includes("reset") && c.includes("--hard") && c.includes("HEAD"))).toBe(true);
  });

  test("cleans up when commit fails after squash", () => {
    const calls: string[][] = [];

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      if (args.includes("commit") && args.includes("-m")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("identity unknown") } as any;
      }
      if (args.includes("diff") && args.includes("--cached") && args.includes("--quiet")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      if (args.includes("log") && args.includes("--pretty=format:%s")) {
        return { exitCode: 0, stdout: Buffer.from("a\nb"), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("commit failed");
    const commitIdx = calls.findIndex(c => c.includes("commit") && c.includes("-m"));
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    const afterCommit = calls.slice(commitIdx + 1);
    expect(afterCommit.some(c => c.includes("reset") && c.includes("--hard") && c.includes("HEAD"))).toBe(true);
  });

  test("cleans up when git log fails after squash", () => {
    const calls: string[][] = [];

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      if (args.includes("log") && args.includes("--pretty=format:%s")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("bad revision") } as any;
      }
      if (args.includes("diff") && args.includes("--cached") && args.includes("--quiet")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("failed to collect commit messages");
    const logIdx = calls.findIndex(c => c.includes("log") && c.includes("--pretty=format:%s"));
    expect(logIdx).toBeGreaterThanOrEqual(0);
    const afterLog = calls.slice(logIdx + 1);
    expect(afterLog.some(c => c.includes("reset") && c.includes("--hard") && c.includes("HEAD"))).toBe(true);
  });

  test("skips when squash produces no changes (idempotency)", () => {
    const commitCalls: string[][] = [];

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      if (args.includes("commit")) {
        commitCalls.push(args);
      }
      if (args.includes("diff") && args.includes("--cached") && args.includes("--quiet")) {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt]);

    expect(result.success).toBe(true);
    expect(commitCalls.length).toBe(0);
  });

  test("merges multiple worktrees independently", () => {
    const wt2 = {
      ...wt,
      repoPath: "/tmp/repo2",
      branchName: "yes-kanban/proj/T-2",
    };

    const squashedBranches: string[] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      if (args.includes("merge") && args.includes("--squash")) {
        const branchIdx = args.indexOf("--squash") + 1;
        if (branchIdx > 0 && args[branchIdx]) squashedBranches.push(args[branchIdx]);
      }
      if (args.includes("diff") && args.includes("--cached") && args.includes("--quiet")) {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt, wt2]);

    expect(result.success).toBe(true);
    expect(squashedBranches).toEqual(["yes-kanban/proj/T-1", "yes-kanban/proj/T-2"]);
  });

  test("stops on first failure with multiple worktrees", () => {
    const wt2 = { ...wt, repoPath: "/tmp/repo2", branchName: "yes-kanban/proj/T-2" };
    const squashRepos: string[] = [];

    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      if (args.includes("merge") && args.includes("--squash")) {
        const cIdx = args.indexOf("-C");
        const repo = cIdx >= 0 ? args[cIdx + 1] : "";
        squashRepos.push(repo ?? "");
        if (repo === "/tmp/repo") {
          return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("CONFLICT") } as any;
        }
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const result = performLocalMerge([wt, wt2]);

    expect(result.success).toBe(false);
    expect(squashRepos).toEqual(["/tmp/repo"]);
  });
});
