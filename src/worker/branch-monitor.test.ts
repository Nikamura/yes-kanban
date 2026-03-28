import { describe, test, expect, spyOn, afterEach, beforeEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import type { ConvexClient } from "convex/browser";
import { pullBaseBranches } from "./branch-monitor";

const TEST_DIRS = ["/tmp/repo", "/tmp/wt", "/tmp/repo-one", "/tmp/wt1", "/tmp/repo-two", "/tmp/wt2"];

describe("pullBaseBranches", () => {
  beforeEach(() => {
    for (const d of TEST_DIRS) mkdirSync(d, { recursive: true });
  });

  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore();
    for (const d of TEST_DIRS) {
      try { rmSync(d, { recursive: true }); } catch { /* ignore */ }
    }
  });

  const wt = {
    repoPath: "/tmp/repo",
    baseBranch: "main",
    branchName: "f",
    worktreePath: "/tmp/wt",
    repoId: "repo1",
  } as any;

  test("uses pull --ff-only when base branch is checked out", async () => {
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      if (args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: Buffer.from("main\n"), stderr: Buffer.from("") } as any;
      }
      if (args.includes("pull")) {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const convex = {
      query: () => [{ _id: "w1", worktrees: [wt] }],
    } as unknown as ConvexClient;

    await pullBaseBranches(convex);

    expect(
      calls.some(
        (c) => c.includes("pull") && c.includes("--ff-only") && c.includes("origin") && c.includes("main"),
      ),
    ).toBe(true);
    expect(calls.some((c) => c.includes("fetch") && c.some((a) => a === "main:main"))).toBe(false);
  });

  test("uses fetch refspec when base branch is not checked out", async () => {
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      if (args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: Buffer.from("feature\n"), stderr: Buffer.from("") } as any;
      }
      if (args.includes("fetch")) {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const convex = {
      query: () => [{ _id: "w1", worktrees: [wt] }],
    } as unknown as ConvexClient;

    await pullBaseBranches(convex);

    expect(calls.some((c) => c.includes("fetch") && c.includes("origin") && c.some((a) => a === "main:main"))).toBe(
      true,
    );
    expect(calls.some((c) => c.includes("pull"))).toBe(false);
  });

  test("uses fetch refspec when HEAD is detached (symbolic-ref fails)", async () => {
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      calls.push(args);
      if (args.includes("symbolic-ref")) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("detached") } as any;
      }
      if (args.includes("fetch")) {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const convex = {
      query: () => [{ _id: "w1", worktrees: [wt] }],
    } as unknown as ConvexClient;

    await pullBaseBranches(convex);

    expect(calls.some((c) => c.includes("fetch") && c.some((a) => a === "main:main"))).toBe(true);
  });

  test("pulls each distinct repoPath:baseBranch when a workspace has multiple worktrees", async () => {
    const pulls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd.map(String) : [];
      if (args.includes("pull") && args.includes("--ff-only")) {
        pulls.push(args);
      }
      if (args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: Buffer.from("main\n"), stderr: Buffer.from("") } as any;
      }
      if (args.includes("pull")) {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const wt1 = {
      repoPath: "/tmp/repo-one",
      baseBranch: "main",
      branchName: "f1",
      worktreePath: "/tmp/wt1",
      repoId: "repo1",
    } as any;
    const wt2 = {
      repoPath: "/tmp/repo-two",
      baseBranch: "main",
      branchName: "f2",
      worktreePath: "/tmp/wt2",
      repoId: "repo2",
    } as any;

    const convex = {
      query: () => [{ _id: "w1", worktrees: [wt1, wt2] }],
    } as unknown as ConvexClient;

    await pullBaseBranches(convex);

    expect(pulls.length).toBe(2);
    expect(pulls.some((p) => p.includes("/tmp/repo-one"))).toBe(true);
    expect(pulls.some((p) => p.includes("/tmp/repo-two"))).toBe(true);
  });
});
