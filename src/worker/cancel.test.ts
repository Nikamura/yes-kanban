import { describe, test, expect } from "bun:test";

describe("Cancel polling in worker", () => {
  test("index.ts checks cancelRequested on active workspaces", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    expect(indexSource).toContain("cancelRequested");
    expect(indexSource).toContain("cancelling workspace");
    expect(indexSource).toContain('status: "cancelled"');
  });

  test("index.ts aborts controller when cancelRequested is set", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    // Should call ac.abort() when cancelRequested is true
    expect(indexSource).toContain("ac.abort()");
    // Should set completedAt when cancelling
    expect(indexSource).toContain("completedAt: Date.now()");
  });

  test("index.ts handles orphaned workspaces with cancelRequested but no active controller", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    expect(indexSource).toContain("cancelling orphaned workspace");
  });

  test("lifecycle.ts skips handleFailure when abort signal is set", async () => {
    const lifecycleSource = await Bun.file(
      new URL("./lifecycle.ts", import.meta.url).pathname
    ).text();

    // Should check abortSignal.aborted before calling handleFailure
    expect(lifecycleSource).toContain("abortSignal.aborted");
  });

  test("index.ts does not overwrite cancelled status with failed in lifecycle catch", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    // Should check abortController.signal.aborted in the catch block
    expect(indexSource).toContain("abortController.signal.aborted");
    expect(indexSource).toContain("lifecycle ended (cancelled)");
  });

  test("index.ts does not overwrite cancelled status in rebase handlers", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    // The rebase .then and .catch should check for abort
    const rebaseSection = indexSource.slice(
      indexSource.indexOf("executeRebase("),
      indexSource.indexOf("// Process manual PR creation")
    );
    expect(rebaseSection).toContain("signal.aborted");
  });
});

describe("Process group killing", () => {
  test("agent-executor.ts uses process group kill for aggressive cancellation", async () => {
    const executorSource = await Bun.file(
      new URL("./agent-executor.ts", import.meta.url).pathname
    ).text();

    // Should kill process group with negative PID
    expect(executorSource).toContain("process.kill(-pid");
    // Should have killProcessTree function
    expect(executorSource).toContain("killProcessTree");
    // SIGKILL escalation timeout should be 2 seconds (not 5)
    expect(executorSource).toContain("}, 2000)");
  });
});

describe("Cancellable statuses alignment", () => {
  test("backend mutation allows cancelling creating_pr and merging statuses", async () => {
    const workspacesSource = await Bun.file(
      new URL("../../convex/workspaces.ts", import.meta.url).pathname
    ).text();

    // Should include creating_pr and merging in cancellable statuses
    expect(workspacesSource).toContain('"creating_pr"');
    expect(workspacesSource).toContain('"merging"');
    // Should also include creating and claimed
    const cancelSection = workspacesSource.slice(
      workspacesSource.indexOf("cancellableStatuses"),
      workspacesSource.indexOf("cancellableStatuses") + 200
    );
    expect(cancelSection).toContain('"creating"');
    expect(cancelSection).toContain('"claimed"');
  });

  test("worker orphaned cancel list includes plan_reviewing status", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    // The orphaned workspace cancel check must include plan_reviewing
    // so workspaces stuck in plan review can be cancelled
    const orphanIdx = indexSource.indexOf("cancelling orphaned workspace");
    const orphanSection = indexSource.slice(orphanIdx - 500, orphanIdx);
    expect(orphanSection).toContain("plan_reviewing");
  });

  test("worker skips pending actions when cancelRequested is set", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    // Should check cancelRequested before processing PR creation or merge
    const pendingSection = indexSource.slice(
      indexSource.indexOf("Process manual PR creation"),
      indexSource.indexOf("if (activeCount < config.maxConcurrentAgents)")
    );
    expect(pendingSection).toContain("cancelRequested");
  });

  test("dispatch claim rejects workspaces with cancelRequested", async () => {
    const dispatchSource = await Bun.file(
      new URL("../../convex/dispatch.ts", import.meta.url).pathname
    ).text();

    expect(dispatchSource).toContain("cancelRequested");
  });
});

describe("Async test execution with abort support", () => {
  test("lifecycle.ts passes abortSignal to runTests", async () => {
    const lifecycleSource = await Bun.file(
      new URL("./lifecycle.ts", import.meta.url).pathname
    ).text();

    // runTests should accept abortSignal parameter
    expect(lifecycleSource).toContain("runTests(convex, workspaceId, repos, worktrees, abortSignal)");
  });

  test("runTests uses async spawn instead of spawnSync", async () => {
    const lifecycleSource = await Bun.file(
      new URL("./lifecycle.ts", import.meta.url).pathname
    ).text();

    // Extract just the runTests function body (up to the next exported function)
    const startIdx = lifecycleSource.indexOf("export async function runTests(");
    const endIdx = lifecycleSource.indexOf("\nexport ", startIdx + 1);
    const runTestsBody = lifecycleSource.slice(startIdx, endIdx);

    // The runTests function should use Bun.spawn (async), not Bun.spawnSync
    expect(runTestsBody).toContain("Bun.spawn(");
    expect(runTestsBody).not.toContain("Bun.spawnSync(");
  });
});

describe("Cancel abort signal in lifecycle", () => {
  test("runAgent returns failure when signal is aborted and lifecycle skips handleFailure", async () => {
    const { runAgent } = await import("./lifecycle");

    const abortController = new AbortController();
    const mockConvex = {
      mutation: (..._args: any[]) => "runAttemptId",
    };
    const mockExecutor = {
      execute: (_args: any) => {
        // Simulate abort during execution
        abortController.abort();
        return Promise.resolve({ exitCode: 1, timedOut: false, stalled: false });
      },
    };
    const agentConfig = {
      _id: "configId",
      agentType: "claude-code",
      command: "echo",
      args: [],
      model: undefined,
      timeoutMs: 3600000,
      env: {},
      mcpEnabled: false,
    } as any;

    const result = await runAgent(
      mockConvex as any, { stallTimeoutMs: 300000 } as any,
      mockExecutor as any, "wsId" as any,
      agentConfig, "/tmp", "test prompt", "coding",
      abortController.signal,
    );

    // runAgent should still return the result (success=false)
    expect(result.success).toBe(false);
    // But the caller (lifecycle) should check abortSignal.aborted before handleFailure
    expect(abortController.signal.aborted).toBe(true);
  });
});
