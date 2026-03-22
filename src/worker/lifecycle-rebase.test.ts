import { describe, test, expect, mock, spyOn, afterEach } from "bun:test";
import { resolveRebaseConflicts, executeRebase } from "./lifecycle";

describe("resolveRebaseConflicts", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore();
  });

  const mockConvex = () => ({
    mutation: mock((..._args: any[]) => "runAttemptId"),
  });

  const baseConfig = { stallTimeoutMs: 300000 } as any;

  const baseAgentConfig = {
    _id: "configId",
    agentType: "claude-code",
    command: "echo",
    args: [],
    model: undefined,
    timeoutMs: 3600000,
    env: {},
    mcpEnabled: false,
  } as any;

  const makeExecutor = (result: { exitCode: number }) => ({
    execute: mock((args: any) => {
      args.onLine("stdout", "Resolving...");
      return Promise.resolve({
        exitCode: result.exitCode,
        timedOut: false,
        stalled: false,
      });
    }),
  });

  const wt = {
    worktreePath: "/tmp/wt",
    baseBranch: "main",
    branchName: "yes-kanban/proj/T-1",
    repoPath: "/tmp/repo",
    repoId: "repo1",
  } as any;

  test("returns true when agent resolves conflicts successfully", async () => {
    const spawnSpy = spyOn(Bun, "spawnSync");

    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("--unmerged")) {
        return { exitCode: 0, stdout: Buffer.from("100644 abc123 1\tsrc/index.ts\n100644 def456 2\tsrc/index.ts\n") } as any;
      }
      // git status --porcelain=v2 → clean (no rebase in progress)
      if (args.includes("--porcelain=v2")) {
        return { exitCode: 0, stdout: Buffer.from("# branch.head main\n") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    const result = await resolveRebaseConflicts(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, wt, new AbortController().signal,
    );

    expect(result).toBe(true);
  });

  test("returns false when no conflicted files found", async () => {
    spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
      stdout: Buffer.from(""),
    } as any);

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    const result = await resolveRebaseConflicts(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, wt, new AbortController().signal,
    );

    expect(result).toBe(false);
  });

  test("returns false when agent fails", async () => {
    const spawnSpy = spyOn(Bun, "spawnSync");
    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("--unmerged")) {
        return { exitCode: 0, stdout: Buffer.from("100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 1 });

    const result = await resolveRebaseConflicts(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, wt, new AbortController().signal,
    );

    expect(result).toBe(false);
  });

  test("returns false when rebase still in progress after agent", async () => {
    const spawnSpy = spyOn(Bun, "spawnSync");
    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("--unmerged")) {
        return { exitCode: 0, stdout: Buffer.from("100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n") } as any;
      }
      // git status shows rebase in progress
      if (args.includes("status")) {
        return { exitCode: 0, stdout: Buffer.from("# branch.head (no branch, rebasing main)\n") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    const result = await resolveRebaseConflicts(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, wt, new AbortController().signal,
    );

    expect(result).toBe(false);
  });

  test("creates run attempt with type rebase_conflict_resolution", async () => {
    const spawnSpy = spyOn(Bun, "spawnSync");
    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("--unmerged")) {
        return { exitCode: 0, stdout: Buffer.from("100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n") } as any;
      }
      if (args.includes("--porcelain=v2")) {
        return { exitCode: 0, stdout: Buffer.from("# branch.head main\n") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    await resolveRebaseConflicts(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, wt, new AbortController().signal,
    );

    const createCall = convex.mutation.mock.calls.find((c: any[]) =>
      c[1]?.type === "rebase_conflict_resolution"
    );
    expect(createCall).toBeDefined();
  });
});

describe("executeRebase", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore();
  });

  const mockConvex = () => ({
    mutation: mock((..._args: any[]) => "runAttemptId"),
  });

  const baseConfig = { stallTimeoutMs: 300000 } as any;

  const baseAgentConfig = {
    _id: "configId",
    agentType: "claude-code",
    command: "echo",
    args: [],
    model: undefined,
    timeoutMs: 3600000,
    env: {},
    mcpEnabled: false,
  } as any;

  const makeExecutor = (result: { exitCode: number }) => ({
    execute: mock((args: any) => {
      args.onLine("stdout", "Working...");
      return Promise.resolve({
        exitCode: result.exitCode,
        timedOut: false,
        stalled: false,
      });
    }),
  });

  const wt = {
    worktreePath: "/tmp/wt",
    baseBranch: "main",
    branchName: "yes-kanban/proj/T-1",
    repoPath: "/tmp/repo",
    repoId: "repo1",
  } as any;

  test("returns success when rebase succeeds without conflicts", async () => {
    const spawnSpy = spyOn(Bun, "spawnSync");
    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      // fetch origin → success
      if (args.includes("fetch")) {
        return { exitCode: 0, stdout: Buffer.from("") } as any;
      }
      // rebase → success
      if (args.includes("rebase")) {
        return { exitCode: 0, stdout: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    const result = await executeRebase(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, [wt], new AbortController().signal,
    );

    expect(result).toBe("success");
  });

  test("returns success when rebase conflicts are resolved by agent", async () => {
    let rebaseCallCount = 0;
    const spawnSpy = spyOn(Bun, "spawnSync");
    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("fetch")) {
        return { exitCode: 0, stdout: Buffer.from("") } as any;
      }
      if (args.includes("rebase") && !args.includes("--abort")) {
        rebaseCallCount++;
        if (rebaseCallCount === 1) {
          return { exitCode: 1, stdout: Buffer.from("CONFLICT"), stderr: Buffer.from("CONFLICT (content): Merge conflict in file.ts") } as any;
        }
      }
      if (args.includes("--unmerged")) {
        return { exitCode: 0, stdout: Buffer.from("100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n") } as any;
      }
      if (args.includes("--porcelain=v2")) {
        return { exitCode: 0, stdout: Buffer.from("# branch.head main\n") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    const result = await executeRebase(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, [wt], new AbortController().signal,
    );

    expect(result).toBe("success");
  });

  test("returns conflict when agent fails to resolve", async () => {
    const spawnSpy = spyOn(Bun, "spawnSync");
    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("fetch")) {
        return { exitCode: 0, stdout: Buffer.from("") } as any;
      }
      if (args.includes("rebase") && !args.includes("--abort")) {
        return { exitCode: 1, stdout: Buffer.from("CONFLICT"), stderr: Buffer.from("CONFLICT (content): Merge conflict in file.ts") } as any;
      }
      if (args.includes("--unmerged")) {
        return { exitCode: 0, stdout: Buffer.from("100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 1 }); // agent fails

    const result = await executeRebase(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, [wt], new AbortController().signal,
    );

    expect(result).toBe("conflict");
  });

  test("aborts rebase when conflict resolution fails", async () => {
    const spawnSpy = spyOn(Bun, "spawnSync");
    const abortCalled: boolean[] = [];

    spawnSpy.mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      if (args.includes("fetch")) {
        return { exitCode: 0, stdout: Buffer.from("") } as any;
      }
      if (args.includes("--abort")) {
        abortCalled.push(true);
        return { exitCode: 0, stdout: Buffer.from("") } as any;
      }
      if (args.includes("rebase")) {
        return { exitCode: 1, stdout: Buffer.from("CONFLICT"), stderr: Buffer.from("CONFLICT (content): Merge conflict in file.ts") } as any;
      }
      if (args.includes("--unmerged")) {
        return { exitCode: 0, stdout: Buffer.from("100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from("") } as any;
    });

    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 1 });

    await executeRebase(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, [wt], new AbortController().signal,
    );

    expect(abortCalled.length).toBeGreaterThan(0);
  });
});
