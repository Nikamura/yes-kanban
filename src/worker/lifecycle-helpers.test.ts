import { describe, test, expect, mock } from "bun:test";
import { handleFailure, runTests, hasFileChanges, shouldLocalMerge } from "./lifecycle";

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
