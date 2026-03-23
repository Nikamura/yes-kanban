import { describe, test, expect, mock } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { cleanGitEnv } from "./worktree-manager";
import {
  handleFailure,
  runTests,
  hasFileChanges,
  shouldLocalMerge,
  canReuseStoredWorktreesForRepos,
  hasPriorCodingRunAttempts,
  hasCompletedSetupRunAttempt,
  isValidGitWorktreePath,
  canReuseWorktreesOnDiskFromState,
  normalizeAttachmentDownloadUrl,
} from "./lifecycle";

describe("handleFailure", () => {
  const makeMockConvex = (attemptCount: number) => ({
    query: mock(() => Array.from({ length: attemptCount }, () => ({}))),
    mutation: mock(() => undefined),
  });

  const baseAgentConfig = {
    _id: "configId",
    maxRetries: 3,
    retryBackoffMs: 10000,
    maxRetryBackoffMs: 300000,
  } as any;

  test("schedules retry when retries remain", async () => {
    const convex = makeMockConvex(1); // 1 attempt so far
    await handleFailure(
      convex as any, {} as any, "wsId" as any,
      baseAgentConfig, { exitCode: 1 }, [], undefined,
    );

    const mutationCalls = convex.mutation.mock.calls;
    // Should call retries.schedule — look for args with dueAt
    const scheduleCalls = mutationCalls.filter((c: any[]) =>
      c[1] && typeof c[1] === "object" && "dueAt" in c[1]
    );
    expect(scheduleCalls.length).toBeGreaterThan(0);
  });

  test("sets status to failed without completedAt when retrying", async () => {
    const convex = makeMockConvex(1);
    await handleFailure(
      convex as any, {} as any, "wsId" as any,
      baseAgentConfig, { exitCode: 1 }, [], undefined,
    );

    const mutationCalls = convex.mutation.mock.calls;
    const statusCall = mutationCalls.find((c: any[]) =>
      c[1] && "status" in c[1] && c[1].status === "failed" && !("completedAt" in c[1])
    );
    expect(statusCall).toBeDefined();
  });

  test("sets completedAt when no retries remain", async () => {
    const convex = makeMockConvex(4); // 4 attempts, maxRetries is 3
    await handleFailure(
      convex as any, {} as any, "wsId" as any,
      baseAgentConfig, { exitCode: 1 }, [], undefined,
    );

    const mutationCalls = convex.mutation.mock.calls;
    const statusCall = mutationCalls.find((c: any[]) =>
      c[1]?.status === "failed" && "completedAt" in c[1]
    );
    expect(statusCall).toBeDefined();
  });

  test("does not schedule retry when retries exhausted", async () => {
    const convex = makeMockConvex(4);
    await handleFailure(
      convex as any, {} as any, "wsId" as any,
      baseAgentConfig, { exitCode: 1 }, [], undefined,
    );

    const mutationCalls = convex.mutation.mock.calls;
    const scheduleCalls = mutationCalls.filter((c: any[]) =>
      c[1] && "dueAt" in c[1]
    );
    expect(scheduleCalls.length).toBe(0);
  });

  test("error message includes exit code", async () => {
    const convex = makeMockConvex(1);
    await handleFailure(
      convex as any, {} as any, "wsId" as any,
      baseAgentConfig, { exitCode: 42 }, [], undefined,
    );

    const mutationCalls = convex.mutation.mock.calls;
    const scheduleCall = mutationCalls.find((c: any[]) => c[1] && "error" in c[1] && "dueAt" in c[1]) as any[];
    expect(scheduleCall).toBeDefined();
    expect(scheduleCall[1].error).toContain("42");
  });

  test("error defaults to 'Agent failed' without exit code", async () => {
    const convex = makeMockConvex(1);
    await handleFailure(
      convex as any, {} as any, "wsId" as any,
      baseAgentConfig, {}, [], undefined,
    );

    const mutationCalls = convex.mutation.mock.calls;
    const scheduleCall = mutationCalls.find((c: any[]) => c[1] && "error" in c[1] && "dueAt" in c[1]) as any[];
    expect(scheduleCall).toBeDefined();
    expect(scheduleCall[1].error).toBe("Agent failed");
  });
});

describe("runTests", () => {
  const mockConvex = () => ({
    mutation: mock(() => "mockRunAttemptId" as unknown),
  });

  test("returns passed when no repos have testCommand", async () => {
    const convex = mockConvex();
    const result = await runTests(
      convex as any, "wsId" as any,
      [{ _id: "repo1", testCommand: undefined, testTimeoutMs: 300000 } as any],
      [{ repoId: "repo1", worktreePath: "/tmp" } as any],
    );
    expect(result).toEqual({ passed: true, output: "" });
  });

  test("returns passed when test command exits 0", async () => {
    const convex = mockConvex();
    const result = await runTests(
      convex as any, "wsId" as any,
      [{ _id: "repo1", testCommand: "echo 'all tests passed'", testTimeoutMs: 300000 } as any],
      [{ repoId: "repo1", worktreePath: "/tmp" } as any],
    );
    expect(result).toEqual({ passed: true, output: "" });
  });

  test("returns failed when test command exits non-zero", async () => {
    const convex = mockConvex();
    const result = await runTests(
      convex as any, "wsId" as any,
      [{ _id: "repo1", testCommand: "echo 'FAIL: test_foo' && exit 1", testTimeoutMs: 300000 } as any],
      [{ repoId: "repo1", worktreePath: "/tmp" } as any],
    );
    expect(result!.passed).toBe(false);
    expect(result!.output).toContain("FAIL: test_foo");
  });

  test("sets status to testing before running", async () => {
    const convex = mockConvex();
    await runTests(
      convex as any, "wsId" as any,
      [{ _id: "repo1", testCommand: "true", testTimeoutMs: 300000 } as any],
      [{ repoId: "repo1", worktreePath: "/tmp" } as any],
    );

    const statusCall = convex.mutation.mock.calls.find((c: any[]) =>
      c[1]?.status === "testing"
    );
    expect(statusCall).toBeDefined();
  });

  test("skips repos without testCommand", async () => {
    const convex = mockConvex();
    await runTests(
      convex as any, "wsId" as any,
      [
        { _id: "repo1", testCommand: undefined, testTimeoutMs: 300000 } as any,
        { _id: "repo2", testCommand: "true", testTimeoutMs: 300000 } as any,
      ],
      [
        { repoId: "repo1", worktreePath: "/tmp" } as any,
        { repoId: "repo2", worktreePath: "/tmp" } as any,
      ],
    );

    const testCreates = convex.mutation.mock.calls.filter(
      (c: unknown[]) => (c[1] as { type?: string }).type === "test",
    );
    expect(testCreates.length).toBe(1);
  });

  test("creates test runAttempt and completes with appendBatch for logs", async () => {
    const convex = mockConvex();
    await runTests(
      convex as any, "wsId" as any,
      [{ _id: "repo1", testCommand: "echo hi", testTimeoutMs: 300000 } as any],
      [{ repoId: "repo1", worktreePath: "/tmp" } as any],
    );
    const testCreate = convex.mutation.mock.calls.find(
      (c: unknown[]) => (c[1] as { type?: string }).type === "test",
    ) as unknown[] | undefined;
    expect(testCreate).toBeDefined();
    expect((testCreate![1] as { prompt: string }).prompt).toContain("echo hi");

    const testComplete = convex.mutation.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { id?: string }).id === "mockRunAttemptId" &&
        (c[1] as { status?: string }).status === "succeeded" &&
        (c[1] as { exitCode?: number }).exitCode === 0,
    );
    expect(testComplete).toBeDefined();

    const appendBatchCalls = convex.mutation.mock.calls.filter(
      (c: unknown[]) => (c[1] as { entries?: unknown[] }).entries !== undefined,
    );
    expect(appendBatchCalls.length).toBe(1);
    const entries = ((appendBatchCalls[0] as unknown[])[1] as { entries: Array<{ stream: string; line: string; structured: null }> })
      .entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toMatchObject({
      stream: expect.stringMatching(/^(stdout|stderr)$/),
      structured: null,
    });
  });
});

describe("shouldLocalMerge", () => {
  test("returns true when column mergePolicy is local_merge", () => {
    expect(shouldLocalMerge({ mergePolicy: "local_merge" }, null)).toBe(true);
  });

  test("returns true when issue has autoMerge enabled", () => {
    expect(shouldLocalMerge(null, { autoMerge: true })).toBe(true);
  });

  test("returns true when both column and issue trigger merge", () => {
    expect(shouldLocalMerge({ mergePolicy: "local_merge" }, { autoMerge: true })).toBe(true);
  });

  test("returns false when neither condition is met", () => {
    expect(shouldLocalMerge(null, null)).toBe(false);
    expect(shouldLocalMerge(null, { autoMerge: false })).toBe(false);
    expect(shouldLocalMerge({ mergePolicy: "pr" }, null)).toBe(false);
    expect(shouldLocalMerge(undefined, undefined)).toBe(false);
  });

  test("returns false when autoMerge is undefined", () => {
    expect(shouldLocalMerge(null, {})).toBe(false);
  });
});

describe("canReuseStoredWorktreesForRepos", () => {
  test("returns true when repos and stored entries match in order", () => {
    const repos = [{ _id: "r1" }, { _id: "r2" }] as any[];
    const stored = [
      { repoId: "r1", worktreePath: "/a" },
      { repoId: "r2", worktreePath: "/b" },
    ] as any[];
    expect(canReuseStoredWorktreesForRepos(repos, stored)).toBe(true);
  });

  test("returns false when lengths differ", () => {
    const repos = [{ _id: "r1" }] as any[];
    const stored = [
      { repoId: "r1", worktreePath: "/a" },
      { repoId: "r2", worktreePath: "/b" },
    ] as any[];
    expect(canReuseStoredWorktreesForRepos(repos, stored)).toBe(false);
  });

  test("returns false when repo order or ids mismatch", () => {
    const repos = [{ _id: "r1" }, { _id: "r2" }] as any[];
    const stored = [
      { repoId: "r2", worktreePath: "/a" },
      { repoId: "r1", worktreePath: "/b" },
    ] as any[];
    expect(canReuseStoredWorktreesForRepos(repos, stored)).toBe(false);
  });
});

describe("hasPriorCodingRunAttempts", () => {
  test("returns true when any attempt has type coding", () => {
    expect(
      hasPriorCodingRunAttempts([{ type: "setup" }, { type: "coding" }]),
    ).toBe(true);
  });

  test("returns false when no coding attempts", () => {
    expect(hasPriorCodingRunAttempts([{ type: "setup" }, { type: "planning" }])).toBe(
      false,
    );
  });
});

describe("hasCompletedSetupRunAttempt", () => {
  test("returns true when a setup attempt succeeded", () => {
    expect(
      hasCompletedSetupRunAttempt([{ type: "planning", status: "succeeded" }, { type: "setup", status: "succeeded" }]),
    ).toBe(true);
  });

  test("returns false when setup never succeeded", () => {
    expect(hasCompletedSetupRunAttempt([{ type: "setup", status: "failed" }])).toBe(false);
    expect(hasCompletedSetupRunAttempt([{ type: "setup", status: "running" }])).toBe(false);
    expect(hasCompletedSetupRunAttempt([{ type: "coding", status: "succeeded" }])).toBe(false);
  });
});

describe("canReuseWorktreesOnDiskFromState", () => {
  const repo = (id: string) => ({ _id: id }) as any;
  const wt = (repoId: string, path: string) => ({
    repoId,
    repoPath: "/repo",
    baseBranch: "main",
    branchName: "feat",
    worktreePath: path,
  });

  test("returns false when workspace is null or undefined", () => {
    expect(canReuseWorktreesOnDiskFromState(null, [repo("r1")], () => true)).toBe(false);
    expect(canReuseWorktreesOnDiskFromState(undefined, [repo("r1")], () => true)).toBe(false);
  });

  test("returns false when worktrees empty or agentCwd empty", () => {
    expect(
      canReuseWorktreesOnDiskFromState({ worktrees: [], agentCwd: "/cwd" } as any, [repo("r1")], () => true),
    ).toBe(false);
    expect(
      canReuseWorktreesOnDiskFromState({ worktrees: [wt("r1", "/a")], agentCwd: "" } as any, [repo("r1")], () => true),
    ).toBe(false);
  });

  test("returns false when repo count or order does not match stored worktrees", () => {
    expect(
      canReuseWorktreesOnDiskFromState(
        { worktrees: [wt("r1", "/a")], agentCwd: "/cwd" } as any,
        [repo("r1"), repo("r2")],
        () => true,
      ),
    ).toBe(false);
  });

  test("returns false when git path validator fails for any worktree", () => {
    expect(
      canReuseWorktreesOnDiskFromState(
        { worktrees: [wt("r1", "/a"), wt("r2", "/b")], agentCwd: "/cwd" } as any,
        [repo("r1"), repo("r2")],
        (p) => p === "/a",
      ),
    ).toBe(false);
  });

  test("returns true when all five conditions pass", () => {
    expect(
      canReuseWorktreesOnDiskFromState(
        { worktrees: [wt("r1", "/a")], agentCwd: "/cwd" } as any,
        [repo("r1")],
        () => true,
      ),
    ).toBe(true);
  });
});

describe("isValidGitWorktreePath", () => {
  test("returns true for a directory with git metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yk-git-"));
    try {
      const init = Bun.spawnSync(["git", "init"], { cwd: dir, env: cleanGitEnv() });
      expect(init.exitCode).toBe(0);
      expect(isValidGitWorktreePath(dir)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns false for a plain directory without git", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yk-nogit-"));
    try {
      expect(isValidGitWorktreePath(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("normalizeAttachmentDownloadUrl", () => {
  test("returns null for empty or whitespace-only", () => {
    expect(normalizeAttachmentDownloadUrl("")).toBeNull();
    expect(normalizeAttachmentDownloadUrl("   ")).toBeNull();
    expect(normalizeAttachmentDownloadUrl("\t\n")).toBeNull();
  });

  test("returns null for non-URL strings", () => {
    expect(normalizeAttachmentDownloadUrl("not a url")).toBeNull();
    expect(normalizeAttachmentDownloadUrl("://bad")).toBeNull();
  });

  test("returns null for non-http(s) protocols", () => {
    expect(normalizeAttachmentDownloadUrl("ftp://example.com/file")).toBeNull();
  });

  test("returns normalized href for http and https", () => {
    expect(normalizeAttachmentDownloadUrl("https://example.com/a%20b")).toBe(
      "https://example.com/a%20b",
    );
    expect(normalizeAttachmentDownloadUrl("http://localhost/x")).toBe("http://localhost/x");
  });

  test("trims surrounding whitespace before parsing", () => {
    expect(normalizeAttachmentDownloadUrl("  https://x.test/y  ")).toBe("https://x.test/y");
  });
});

describe("hasFileChanges", () => {
  test("returns false for empty diff", () => {
    expect(hasFileChanges("")).toBe(false);
  });

  test("returns false for whitespace-only diff", () => {
    expect(hasFileChanges("  \n\t\n  ")).toBe(false);
  });

  test("returns true for non-empty diff", () => {
    const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
+console.log("hello");
`;
    expect(hasFileChanges(diff)).toBe(true);
  });
});
