export interface IForgeAdapter {
  checkAvailability(): Promise<{ available: boolean; error?: string }>;
  createPullRequest(args: {
    worktreePath: string;
    repoPath: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<{ url: string }>;
  getPullRequestStatus(args: {
    repoPath: string;
    branch: string;
  }): Promise<{ exists: boolean; url?: string; status?: string } | null>;
}

export function getForgeAdapter(type: string): IForgeAdapter {
  switch (type) {
    case "github":
      return new GitHubAdapter();
    case "gitlab":
      return new GitLabAdapter();
    case "azure":
      return new AzureDevOpsAdapter();
    default:
      return new GitHubAdapter();
  }
}

class GitHubAdapter implements IForgeAdapter {
  checkAvailability(): Promise<{ available: boolean; error?: string }> {
    const result = Bun.spawnSync(["gh", "auth", "status"], { timeout: 10000 });
    if (result.exitCode !== 0) {
      return Promise.resolve({ available: false, error: "gh CLI not authenticated. Run: gh auth login" });
    }
    return Promise.resolve({ available: true });
  }

  createPullRequest(args: {
    worktreePath: string;
    repoPath: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<{ url: string }> {
    // Push branch
    const push = Bun.spawnSync(
      ["git", "-C", args.worktreePath, "push", "-u", "origin", args.branch],
      { timeout: 60000 }
    );
    if (push.exitCode !== 0) {
      return Promise.reject(new Error(`Failed to push: ${push.stderr.toString()}`));
    }

    // Create PR
    const pr = Bun.spawnSync(
      [
        "gh", "pr", "create",
        "--title", args.title,
        "--body", args.body,
        "--base", args.baseBranch,
        "--head", args.branch,
      ],
      { cwd: args.worktreePath, timeout: 30000 }
    );
    if (pr.exitCode !== 0) {
      return Promise.reject(new Error(`Failed to create PR: ${pr.stderr.toString()}`));
    }

    const url = pr.stdout.toString().trim();
    return Promise.resolve({ url });
  }

  getPullRequestStatus(args: {
    repoPath: string;
    branch: string;
  }): Promise<{ exists: boolean; url?: string; status?: string } | null> {
    const result = Bun.spawnSync(
      ["gh", "pr", "view", args.branch, "--json", "url,state"],
      { cwd: args.repoPath, timeout: 10000 }
    );
    if (result.exitCode !== 0) {
      return Promise.resolve({ exists: false });
    }
    try {
      const data = JSON.parse(result.stdout.toString());
      return Promise.resolve({ exists: true, url: data.url, status: data.state });
    } catch {
      return Promise.resolve({ exists: false });
    }
  }
}

class GitLabAdapter implements IForgeAdapter {
  checkAvailability() {
    const result = Bun.spawnSync(["glab", "auth", "status"], { timeout: 10000 });
    return Promise.resolve(result.exitCode === 0
      ? { available: true }
      : { available: false, error: "glab CLI not authenticated. Run: glab auth login" });
  }

  createPullRequest(args: {
    worktreePath: string;
    repoPath: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
  }) {
    const push = Bun.spawnSync(["git", "-C", args.worktreePath, "push", "-u", "origin", args.branch], { timeout: 60000 });
    if (push.exitCode !== 0) {
      return Promise.reject(new Error(`Failed to push: ${push.stderr.toString()}`));
    }
    const pr = Bun.spawnSync(
      ["glab", "mr", "create", "--title", args.title, "--description", args.body, "--source-branch", args.branch, "--target-branch", args.baseBranch],
      { cwd: args.worktreePath, timeout: 30000 }
    );
    if (pr.exitCode !== 0) {
      return Promise.reject(new Error(`Failed to create MR: ${pr.stderr.toString()}`));
    }
    return Promise.resolve({ url: pr.stdout.toString().trim() });
  }

  getPullRequestStatus(args: { repoPath: string; branch: string }) {
    const result = Bun.spawnSync(["glab", "mr", "view", args.branch], { cwd: args.repoPath, timeout: 10000 });
    return Promise.resolve(result.exitCode === 0 ? { exists: true } : { exists: false });
  }
}

class AzureDevOpsAdapter implements IForgeAdapter {
  checkAvailability() {
    const result = Bun.spawnSync(["az", "devops", "--help"], { timeout: 10000 });
    return Promise.resolve(result.exitCode === 0
      ? { available: true }
      : { available: false, error: "az CLI not available. Install: az extension add --name azure-devops" });
  }

  createPullRequest(args: {
    worktreePath: string;
    repoPath: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
  }) {
    const push = Bun.spawnSync(["git", "-C", args.worktreePath, "push", "-u", "origin", args.branch], { timeout: 60000 });
    if (push.exitCode !== 0) {
      return Promise.reject(new Error(`Failed to push: ${push.stderr.toString()}`));
    }
    const pr = Bun.spawnSync(
      ["az", "repos", "pr", "create", "--title", args.title, "--description", args.body, "--source-branch", args.branch, "--target-branch", args.baseBranch],
      { cwd: args.worktreePath, timeout: 30000 }
    );
    if (pr.exitCode !== 0) {
      return Promise.reject(new Error(`Failed to create PR: ${pr.stderr.toString()}`));
    }
    try {
      const data = JSON.parse(pr.stdout.toString());
      return Promise.resolve({ url: data.url ?? "" });
    } catch {
      return Promise.reject(new Error(`Failed to parse PR response: ${pr.stdout.toString()}`));
    }
  }

  getPullRequestStatus(args: { repoPath: string; branch: string }) {
    const result = Bun.spawnSync(["az", "repos", "pr", "list", "--source-branch", args.branch, "--output", "json"], { cwd: args.repoPath, timeout: 10000 });
    try {
      const data = JSON.parse(result.stdout.toString());
      return Promise.resolve(data.length > 0 ? { exists: true, url: data[0].url } : { exists: false });
    } catch {
      return Promise.resolve({ exists: false });
    }
  }
}
