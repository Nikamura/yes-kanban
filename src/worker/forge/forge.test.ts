import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { getForgeAdapter } from "./index";

describe("getForgeAdapter", () => {
  test("github returns adapter with full interface", () => {
    const adapter = getForgeAdapter("github");
    expect(typeof adapter.checkAvailability).toBe("function");
    expect(typeof adapter.createPullRequest).toBe("function");
    expect(typeof adapter.getPullRequestStatus).toBe("function");
  });

  test("gitlab returns adapter with full interface", () => {
    const adapter = getForgeAdapter("gitlab");
    expect(typeof adapter.checkAvailability).toBe("function");
    expect(typeof adapter.createPullRequest).toBe("function");
    expect(typeof adapter.getPullRequestStatus).toBe("function");
  });

  test("azure returns adapter with full interface", () => {
    const adapter = getForgeAdapter("azure");
    expect(typeof adapter.checkAvailability).toBe("function");
    expect(typeof adapter.createPullRequest).toBe("function");
    expect(typeof adapter.getPullRequestStatus).toBe("function");
  });

  test("unknown type defaults to github adapter", () => {
    const adapter = getForgeAdapter("bitbucket");
    expect(typeof adapter.checkAvailability).toBe("function");
    expect(typeof adapter.createPullRequest).toBe("function");
    expect(typeof adapter.getPullRequestStatus).toBe("function");
  });
});

describe("GitHubAdapter", () => {
  afterEach(() => {
    // Restore any mocks
    spyOn(Bun, "spawnSync").mockRestore();
  });

  describe("checkAvailability", () => {
    test("returns available when gh auth succeeds", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as any);

      const adapter = getForgeAdapter("github");
      const result = await adapter.checkAvailability();
      expect(result.available).toBe(true);
    });

    test("returns unavailable when gh auth fails", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 1,
        stdout: Buffer.from(""),
        stderr: Buffer.from("not logged in"),
      } as any);

      const adapter = getForgeAdapter("github");
      const result = await adapter.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.error).toContain("gh CLI not authenticated");
    });
  });

  describe("createPullRequest", () => {
    test("returns PR URL on success", async () => {
      const spy = spyOn(Bun, "spawnSync");
      // First call: git push
      spy.mockReturnValueOnce({
        exitCode: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as any);
      // Second call: gh pr create
      spy.mockReturnValueOnce({
        exitCode: 0,
        stdout: Buffer.from("https://github.com/org/repo/pull/42\n"),
        stderr: Buffer.from(""),
      } as any);

      const adapter = getForgeAdapter("github");
      const result = await adapter.createPullRequest({
        worktreePath: "/tmp/wt",
        repoPath: "/tmp/repo",
        baseBranch: "main",
        branch: "feature-branch",
        title: "Add feature",
        body: "Description",
      });
      expect(result.url).toBe("https://github.com/org/repo/pull/42");
    });

    test("rejects when git push fails", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 1,
        stdout: Buffer.from(""),
        stderr: Buffer.from("push rejected"),
      } as any);

      const adapter = getForgeAdapter("github");
      let error: Error | undefined;
      try {
        await adapter.createPullRequest({
          worktreePath: "/tmp/wt",
          repoPath: "/tmp/repo",
          baseBranch: "main",
          branch: "feature",
          title: "Title",
          body: "Body",
        });
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.message).toContain("Failed to push");
    });
  });

  describe("getPullRequestStatus", () => {
    test("returns exists with url and status on success", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ url: "https://github.com/org/repo/pull/1", state: "OPEN" })),
        stderr: Buffer.from(""),
      } as any);

      const adapter = getForgeAdapter("github");
      const result = await adapter.getPullRequestStatus({
        repoPath: "/tmp/repo",
        branch: "feature",
      });
      expect(result).toEqual({ exists: true, url: "https://github.com/org/repo/pull/1", status: "OPEN" });
    });

    test("returns exists false when no PR found", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 1,
        stdout: Buffer.from(""),
        stderr: Buffer.from("no PR found"),
      } as any);

      const adapter = getForgeAdapter("github");
      const result = await adapter.getPullRequestStatus({
        repoPath: "/tmp/repo",
        branch: "feature",
      });
      expect(result).toEqual({ exists: false });
    });

    test("returns exists false on invalid JSON", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 0,
        stdout: Buffer.from("not json"),
        stderr: Buffer.from(""),
      } as any);

      const adapter = getForgeAdapter("github");
      const result = await adapter.getPullRequestStatus({
        repoPath: "/tmp/repo",
        branch: "feature",
      });
      expect(result).toEqual({ exists: false });
    });
  });
});

const prArgs = {
  worktreePath: "/tmp/wt",
  repoPath: "/tmp/repo",
  baseBranch: "main",
  branch: "feature",
  title: "Title",
  body: "Body",
};

describe("GitLabAdapter", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore();
  });

  describe("createPullRequest", () => {
    test("returns MR URL on success", async () => {
      const spy = spyOn(Bun, "spawnSync");
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""),
      } as any);
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from("https://gitlab.com/org/repo/-/merge_requests/1\n"), stderr: Buffer.from(""),
      } as any);

      const adapter = getForgeAdapter("gitlab");
      const result = await adapter.createPullRequest(prArgs);
      expect(result.url).toBe("https://gitlab.com/org/repo/-/merge_requests/1");
    });

    test("rejects when git push fails", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("push rejected"),
      } as any);

      const adapter = getForgeAdapter("gitlab");
      expect(adapter.createPullRequest(prArgs)).rejects.toThrow("Failed to push");
    });

    test("rejects when glab mr create fails", async () => {
      const spy = spyOn(Bun, "spawnSync");
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""),
      } as any);
      spy.mockReturnValueOnce({
        exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("mr create failed"),
      } as any);

      const adapter = getForgeAdapter("gitlab");
      expect(adapter.createPullRequest(prArgs)).rejects.toThrow("Failed to create MR");
    });
  });
});

describe("AzureDevOpsAdapter", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore();
  });

  describe("createPullRequest", () => {
    test("returns PR URL on success", async () => {
      const spy = spyOn(Bun, "spawnSync");
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""),
      } as any);
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from(JSON.stringify({ url: "https://dev.azure.com/org/repo/_git/pullrequest/1" })), stderr: Buffer.from(""),
      } as any);

      const adapter = getForgeAdapter("azure");
      const result = await adapter.createPullRequest(prArgs);
      expect(result.url).toBe("https://dev.azure.com/org/repo/_git/pullrequest/1");
    });

    test("rejects when git push fails", async () => {
      spyOn(Bun, "spawnSync").mockReturnValue({
        exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("push rejected"),
      } as any);

      const adapter = getForgeAdapter("azure");
      expect(adapter.createPullRequest(prArgs)).rejects.toThrow("Failed to push");
    });

    test("rejects when az repos pr create fails", async () => {
      const spy = spyOn(Bun, "spawnSync");
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""),
      } as any);
      spy.mockReturnValueOnce({
        exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("pr create failed"),
      } as any);

      const adapter = getForgeAdapter("azure");
      expect(adapter.createPullRequest(prArgs)).rejects.toThrow("Failed to create PR");
    });

    test("rejects when az returns invalid JSON", async () => {
      const spy = spyOn(Bun, "spawnSync");
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from(""),
      } as any);
      spy.mockReturnValueOnce({
        exitCode: 0, stdout: Buffer.from("not json"), stderr: Buffer.from(""),
      } as any);

      const adapter = getForgeAdapter("azure");
      expect(adapter.createPullRequest(prArgs)).rejects.toThrow("Failed to parse PR response");
    });
  });
});
