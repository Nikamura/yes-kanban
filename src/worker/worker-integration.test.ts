import { describe, test, expect } from "bun:test";

describe("Worker lifecycle integration", () => {
  test("index.ts imports runLifecycle from lifecycle", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    expect(indexSource).toContain('from "./lifecycle"');
    expect(indexSource).toContain("runLifecycle");
    expect(indexSource).not.toContain("function executeTask");
    expect(indexSource).not.toContain("executeTask(");
  });

  test("index.ts does not import unused modules after refactor", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    // These are handled inside lifecycle.ts, not needed directly in index
    // worktree-manager IS used in index.ts for post-merge cleanup
    expect(indexSource).not.toContain('from "./adapters"');
    expect(indexSource).not.toContain('from "./prompt-builder"');
  });

  test("index.ts creates AbortController at call site and passes signal to runLifecycle", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    expect(indexSource).toContain("new AbortController()");
    expect(indexSource).toContain("abortController.signal");
    expect(indexSource).toContain("runLifecycle(");
  });

  test("dispatch claim mutation does not set status to coding", async () => {
    const dispatchSource = await Bun.file(
      new URL("../../convex/dispatch.ts", import.meta.url).pathname
    ).text();

    // The claim mutation should set status to "claimed" not "coding" — lifecycle manages transitions
    expect(dispatchSource).not.toMatch(/patch\([^)]*\{[^}]*status:\s*"coding"/);
    expect(dispatchSource).toMatch(/status:\s*"claimed"/);
  });

  test("runLifecycle is exported from lifecycle.ts", async () => {
    const lifecycle = await import("./lifecycle");
    expect(typeof lifecycle.runLifecycle).toBe("function");
  });

  test("recoverOrphanedWorkspaces returns creating status for in-progress workspaces", async () => {
    const { recoverOrphanedWorkspaces } = await import("./graceful-restart");

    const orphaned = [
      { _id: "ws-1" as any, status: "coding" },
      { _id: "ws-2" as any, status: "testing" },
      { _id: "ws-3" as any, status: "completed" }, // terminal — should be skipped
    ];

    const updates = recoverOrphanedWorkspaces(orphaned);
    expect(updates).toHaveLength(2);
    expect(updates[0]!.status).toBe("creating");
    expect(updates[1]!.status).toBe("creating");
  });

  test("shouldRequeueOnShutdown correctly classifies statuses", async () => {
    const { shouldRequeueOnShutdown } = await import("./graceful-restart");

    expect(shouldRequeueOnShutdown("coding")).toBe(true);
    expect(shouldRequeueOnShutdown("merging")).toBe(true);
    expect(shouldRequeueOnShutdown("failed")).toBe(false);
    expect(shouldRequeueOnShutdown("completed")).toBe(false);
    expect(shouldRequeueOnShutdown("merge_failed")).toBe(false);
  });

  test("index.ts sets merge_failed status on merge failure, not completed or failed", async () => {
    const indexSource = await Bun.file(
      new URL("./index.ts", import.meta.url).pathname
    ).text();

    // When local merge fails, should set merge_failed (not completed or generic failed)
    expect(indexSource).toContain('status: "merge_failed"');
  });

  test("lifecycle.ts sets merge_failed status on auto-merge failure", async () => {
    const lifecycleSource = await Bun.file(
      new URL("./lifecycle.ts", import.meta.url).pathname
    ).text();

    // When auto local merge fails, should set merge_failed
    expect(lifecycleSource).toContain('status: "merge_failed"');
  });

  test("workspaces retry mutation accepts merge_failed and sets merging status", async () => {
    const workspacesSource = await Bun.file(
      new URL("../../convex/workspaces.ts", import.meta.url).pathname
    ).text();

    // merge_failed should be in the retryable statuses list
    expect(workspacesSource).toContain('"merge_failed"');
    // Retry from merge_failed should go to "merging", not "creating"
    expect(workspacesSource).toContain('workspace.status === "merge_failed" ? "merging" : "creating"');
  });
});
