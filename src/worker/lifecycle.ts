import type { ConvexClient } from "convex/browser";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { GitWorktreeManager, cleanGitEnv } from "./worktree-manager";
import { AgentExecutor, type StallPauseSignal } from "./agent-executor";
import { getAdapter } from "./adapters";
import { buildPrompt, buildReviewPrompt, buildPlanReviewPrompt, buildRebaseConflictPrompt, buildPlanningPrompt, buildGrillingPrompt, buildFixPrompt, buildTestFixPrompt } from "./prompt-builder";
import { getForgeAdapter } from "./forge";
import { McpServer, type ExternalMcpConfig } from "./mcp-server";
import type { WorkerConfig, DispatchTask, WorktreeEntry, LogEntry, AgentEvent, AttachmentInfo, ScriptLogger } from "./types";
import { computeBackoffDelay, shouldRetry, TERMINAL_STATUSES } from "./retry";
import { consumeStreamLines } from "./stream-lines";
import { READ_ONLY_TOOLS, PLANNING_TOOLS, PLANNING_RESEARCH_TOOLS, GRILLING_TOOLS, CODING_TOOLS, REVIEW_TOOLS } from "./mcp-tools";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "fs";
import { unlink } from "fs/promises";
import { basename, dirname, join, resolve } from "path";

/** Clamp object nesting depth to avoid Convex's 16-level document limit. */
function clampDepth(value: unknown, maxDepth: number, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (depth >= maxDepth) {
    try { return JSON.stringify(value); } catch { return "[too deep]"; }
  }
  if (Array.isArray(value)) {
    return value.map((item) => clampDepth(item, maxDepth, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = clampDepth(v, maxDepth, depth + 1);
  }
  return result;
}

const ATTACHMENTS_DIR = ".yes-kanban-attachments";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

/** Max chars of attachment URL to include in warning logs (avoid huge lines). */
const ATTACHMENT_URL_LOG_MAX = 120;

/**
 * Returns a normalized http(s) URL string for fetch, or null if missing/invalid.
 * Convex `getUrl` should yield https URLs; this guards empty strings and garbage.
 * Exported for unit tests.
 */
export function normalizeAttachmentDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function formatAttachmentUrlForLog(url: string): string {
  return url.length > ATTACHMENT_URL_LOG_MAX ? `${url.slice(0, ATTACHMENT_URL_LOG_MAX)}…` : url;
}
/** Truncate stored script prompts for runAttempts (Convex document size). */
const MAX_SCRIPT_PROMPT_LEN = 50_000;

/** True if `worktreePath` is a valid git working tree (linked worktree or main checkout). */
export function isValidGitWorktreePath(worktreePath: string): boolean {
  const r = Bun.spawnSync(
    ["git", "-C", worktreePath, "rev-parse", "--git-dir"],
    { timeout: 5000, env: cleanGitEnv() },
  );
  return r.exitCode === 0;
}

/** True if stored worktrees match the current repo list (same repos, same order). */
export function canReuseStoredWorktreesForRepos(
  repos: Doc<"repos">[],
  stored: WorktreeEntry[],
): boolean {
  if (stored.length !== repos.length) return false;
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    const entry = stored[i];
    if (!repo || repo._id !== entry?.repoId) return false;
  }
  return true;
}

/**
 * True if any run attempt has type `"coding"`.
 * Only meaningful when `attempts` are listed **before** the current lifecycle creates a coding
 * `runAttempts` row (see `runLifecycle`: we query immediately after worktrees, before planning/coding agents).
 */
export function hasPriorCodingRunAttempts(attempts: { type: string }[]): boolean {
  return attempts.some((a) => a.type === "coding");
}

/** True if a prior lifecycle completed a setup runAttempt successfully (skip re-running setup on re-dispatch). */
export function hasCompletedSetupRunAttempt(
  attempts: { type: string; status: string }[],
): boolean {
  return attempts.some((a) => a.type === "setup" && a.status === "succeeded");
}

/**
 * True if persisted workspace worktrees can be reused without `createWorktrees` (same logic as
 * `canReuseWorktreesOnDisk` in `runLifecycle`). `workspace` is the Convex document or nullish if missing.
 */
export function canReuseWorktreesOnDiskFromState(
  workspace: Doc<"workspaces"> | null | undefined,
  repos: Doc<"repos">[],
  isValidGitWorktree: (path: string) => boolean = isValidGitWorktreePath,
): boolean {
  // Loose `== null` covers both `null` and `undefined` from Convex/client queries.
  // eslint-disable-next-line eqeqeq -- intentional nullish guard
  if (workspace == null) return false;
  const storedWts = workspace.worktrees;
  return (
    storedWts.length > 0 &&
    workspace.agentCwd.length > 0 &&
    canReuseStoredWorktreesForRepos(repos, storedWts) &&
    storedWts.every((wt) => isValidGitWorktree(wt.worktreePath))
  );
}

/** Appended to commit messages created by Yes Kanban (git trailer convention). */
const YES_KANBAN_GIT_TRAILER = "Generated-by: Yes Kanban";

/**
 * Download issue attachments to a local directory inside the worktree
 * so the agent can access them via the Read tool.
 */
async function downloadAttachments(
  attachments: AttachmentInfo[],
  worktreePath: string,
): Promise<void> {
  const dir = join(worktreePath, ATTACHMENTS_DIR);
  mkdirSync(dir, { recursive: true });

  // Add to .git/info/exclude so attachments aren't committed
  const gitExcludePath = join(worktreePath, ".git", "info", "exclude");
  // Worktrees use a .git file pointing to the real gitdir — resolve it
  const dotGit = join(worktreePath, ".git");
  let excludePath = gitExcludePath;
  if (existsSync(dotGit)) {
    try {
      const content = readFileSync(dotGit, "utf-8").trim();
      if (content.startsWith("gitdir:")) {
        const gitdir = resolve(worktreePath, content.slice("gitdir:".length).trim());
        excludePath = join(gitdir, "info", "exclude");
      }
    } catch { /* fall back to default */ }
  }

  try {
    const excludeContent = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
    if (!excludeContent.includes(ATTACHMENTS_DIR)) {
      mkdirSync(dirname(excludePath), { recursive: true });
      appendFileSync(excludePath, `\n${ATTACHMENTS_DIR}/\n`);
    }
  } catch (err) {
    console.warn(`[lifecycle] failed to update git exclude:`, err);
  }

  // Track used filenames to handle collisions
  const usedNames = new Set<string>();

  for (const att of attachments) {
    if (att.size > MAX_ATTACHMENT_SIZE) {
      console.log(`[lifecycle] skipping large attachment ${att.filename} (${(att.size / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }

    const fetchUrl = normalizeAttachmentDownloadUrl(att.url);
    if (!fetchUrl) {
      console.warn(`[lifecycle] skipping attachment ${att.filename}: invalid or empty URL`);
      continue;
    }

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        console.warn(`[lifecycle] failed to download attachment ${att.filename}: HTTP ${response.status}`);
        continue;
      }

      // Sanitize filename to prevent path traversal
      let filename = basename(att.filename).replace(/^\.+/, "");
      if (!filename) filename = `attachment-${usedNames.size}`;
      if (usedNames.has(filename)) {
        const dotIdx = filename.lastIndexOf(".");
        const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
        const ext = dotIdx > 0 ? filename.slice(dotIdx) : "";
        let counter = 2;
        while (usedNames.has(`${base}-${counter}${ext}`)) counter++;
        filename = `${base}-${counter}${ext}`;
      }
      usedNames.add(filename);

      const buffer = Buffer.from(await response.arrayBuffer());
      const localPath = join(dir, filename);
      writeFileSync(localPath, buffer);
      att.localPath = localPath;

      console.log(`[lifecycle] downloaded attachment ${att.filename} -> ${localPath}`);
    } catch (err) {
      console.warn(
        `[lifecycle] failed to download attachment ${att.filename} (url=${formatAttachmentUrlForLog(att.url)}):`,
        err,
      );
    }
  }
}

/**
 * Check whether a git diff contains actual file changes.
 */
export function hasFileChanges(diff: string): boolean {
  return diff.trim().length > 0;
}

function createScriptLogFlusher(
  convex: ConvexClient,
  runAttemptId: Id<"runAttempts">,
  workspaceId: Id<"workspaces">,
): { logger: ScriptLogger; flush: () => Promise<void> } {
  const logBuffer: LogEntry[] = [];
  const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
  /** After `flush()` finishes, late `onLine` calls flush immediately (no orphaned buffer). */
  let flushEnded = false;

  const flushLogs = async () => {
    if (logBuffer.length > 0) {
      const entries = logBuffer.splice(0, logBuffer.length);
      try {
        await convex.mutation(api.agentLogs.appendBatch, { entries });
      } catch (err) {
        console.warn("[lifecycle] agentLogs.appendBatch failed:", err);
      }
    }
  };

  const logger: ScriptLogger = {
    onLine: (stream, line) => {
      logBuffer.push({
        runAttemptId,
        workspaceId,
        stream,
        line,
        structured: null,
        timestamp: Date.now(),
      });
      if (flushEnded) {
        void flushLogs();
        return;
      }
      timerRef.current ??= setTimeout(() => {
        timerRef.current = null;
        void flushLogs();
      }, 100);
    },
  };

  const flush = async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    flushEnded = true;
    await flushLogs();
  };

  return { logger, flush };
}

async function removeWorktreesWithOptionalScriptLogs(
  convex: ConvexClient,
  worktreeManager: GitWorktreeManager,
  workspaceId: Id<"workspaces">,
  worktrees: WorktreeEntry[],
  repos: Doc<"repos">[],
): Promise<void> {
  const fragments: string[] = [];
  for (const wt of worktrees) {
    const repo = repos.find((r) => r._id === wt.repoId);
    if (repo?.cleanupScript) {
      fragments.push(`[${repo.slug}]\n${repo.cleanupScript}`);
    }
  }
  if (fragments.length === 0) {
    await worktreeManager.removeWorktrees({ worktrees, repos });
    return;
  }
  let prompt = fragments.join("\n\n");
  if (prompt.length > MAX_SCRIPT_PROMPT_LEN) {
    prompt = prompt.slice(0, MAX_SCRIPT_PROMPT_LEN) + "\n\n... [truncated]";
  }
  const runAttemptId = await convex.mutation(api.runAttempts.create, {
    workspaceId,
    type: "cleanup",
    prompt,
  });
  const { logger, flush } = createScriptLogFlusher(convex, runAttemptId, workspaceId);
  let cleanupErr: unknown;
  try {
    await worktreeManager.removeWorktrees({ worktrees, repos, logger });
  } catch (err) {
    cleanupErr = err;
    console.error(`[lifecycle] workspace=${workspaceId} removeWorktrees failed:`, err);
  } finally {
    await flush();
    await convex.mutation(api.runAttempts.complete, {
      id: runAttemptId,
      status: cleanupErr ? "failed" : "succeeded",
      exitCode: cleanupErr ? undefined : 0,
      // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions
      error: cleanupErr instanceof Error ? cleanupErr.message : cleanupErr ? `${cleanupErr}` : undefined,
    });
  }
}

/** Line-start patterns for agent CLI footers in commit messages (subjects or bodies). */
const ATTRIBUTION_PATTERNS = [
  /^Generated by \[Cursor\]/,
  /^🤖 Generated with \[Claude Code\]/,
];

export function isAgentAttribution(line: string): boolean {
  return ATTRIBUTION_PATTERNS.some((p) => p.test(line.trim()));
}

/**
 * Determine whether completed work should be locally merged (vs PR creation).
 * Triggers when the project has mergePolicy "local_merge" or the issue has autoMerge enabled.
 */
export function shouldLocalMerge(
  project: { mergePolicy?: string | null } | null | undefined,
  issue: { autoMerge?: boolean } | null | undefined,
): boolean {
  return project?.mergePolicy === "local_merge" || issue?.autoMerge === true;
}

/**
 * Commit any uncommitted changes left by the agent.
 * Agents are instructed to commit, but may leave dirty state on failure/timeout.
 * A clean worktree is required for rebase, test, and review stages.
 */
function commitUnstagedChanges(worktreePath: string, issueId: string): boolean {
  // Check if there are uncommitted changes
  const status = Bun.spawnSync(
    ["git", "-C", worktreePath, "status", "--porcelain"],
    { timeout: 5000, env: cleanGitEnv() },
  );
  const statusOutput = status.stdout.toString().trim();
  if (!statusOutput) return false; // already clean

  // Stage all changes
  Bun.spawnSync(
    ["git", "-C", worktreePath, "add", "-A"],
    { timeout: 10000, env: cleanGitEnv() },
  );

  // Commit
  const result = Bun.spawnSync(
    [
      "git",
      "-C",
      worktreePath,
      "commit",
      "-m",
      `${issueId}: WIP — auto-commit uncommitted changes\n\n${YES_KANBAN_GIT_TRAILER}`,
    ],
    { timeout: 10000, env: cleanGitEnv() },
  );

  return result.exitCode === 0;
}

/**
 * Start periodic diff polling that updates the workspace's diffOutput in Convex.
 * Returns a cleanup function to stop polling.
 */
function startDiffPolling(
  convex: ConvexClient,
  worktreeManager: GitWorktreeManager,
  workspaceId: Id<"workspaces">,
  worktrees: WorktreeEntry[],
  intervalMs = 5000,
): () => void {
  if (worktrees.length === 0) return () => {};
  const firstWt = worktrees[0];
  if (!firstWt) return () => {};

  let lastDiff = "";

  const timer = setInterval(() => {
    void (async () => {
      try {
        const diff = await worktreeManager.getDiff(firstWt.worktreePath, firstWt.baseBranch);
        if (diff !== lastDiff) {
          lastDiff = diff;
          await convex.mutation(api.workspaces.updateDiff, {
            id: workspaceId,
            diffOutput: diff,
          });
        }
      } catch {
        // Diff polling is best-effort — don't crash the lifecycle
      }
    })();
  }, intervalMs);

  return () => clearInterval(timer);
}

const PHASE_CAPACITY_POLL_MS = 3000;

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/**
 * Polls `canEnterPhase` until capacity or abort (see SPEC §9.5 for optimistic concurrency).
 * Returns false when aborted before capacity is available.
 */
async function waitForPhaseCapacity(
  convex: ConvexClient,
  workspaceId: Id<"workspaces">,
  phase: "planning" | "coding" | "testing" | "reviewing",
  abortSignal: AbortSignal,
): Promise<boolean> {
  while (!abortSignal.aborted) {
    const ok = await convex.query(api.dispatch.canEnterPhase, { workspaceId, phase });
    if (ok) return true;
    console.log(`[lifecycle] workspace=${workspaceId} waiting for ${phase} slot (phase concurrency)`);
    try {
      await sleepAbortable(PHASE_CAPACITY_POLL_MS, abortSignal);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Full development lifecycle for a workspace:
 * creating → coding → reviewing → testing → completed
 * Post-completion actions (triggered manually from UI):
 *   - Create PR: completed → creating_pr → pr_open
 *   - Local merge: completed → merging → merged
 *   - Rebase: completed → rebasing → completed
 */
export async function runLifecycle(
  convex: ConvexClient,
  config: WorkerConfig,
  task: DispatchTask,
  abortSignal: AbortSignal,
) {
  const { workspaceId, agentConfig, repos, issue } = task;
  const worktreeManager = new GitWorktreeManager(config.worktreeRoot);
  const executor = new AgentExecutor();

  if (issue) {
    const currentWorkspaceForCol = await convex.query(api.workspaces.get, { id: workspaceId });
    // Persist sourceColumn when missing (older workspaces); workflow uses project settings, not column lookup.
    if (!currentWorkspaceForCol?.sourceColumn) {
      await convex.mutation(api.workspaces.setSourceColumn, {
        id: workspaceId,
        sourceColumn: issue.status,
      });
    }
  }

  const project = await convex.query(api.projects.get, { id: task.projectId });

  // Resolve prompt templates (project-level > global > hardcoded fallback)
  const workflowTemplate = await convex.query(api.promptTemplates.resolve, {
    projectId: task.projectId,
    type: "workflow",
  });
  const reviewTemplate = await convex.query(api.promptTemplates.resolve, {
    projectId: task.projectId,
    type: "review",
  });
  // 1. Create worktrees (or reuse existing on-disk worktrees from a prior dispatch)
  const workspaceForReuse = await convex.query(api.workspaces.get, { id: workspaceId });
  const storedWts = workspaceForReuse?.worktrees ?? [];
  const canReuseWorktreesOnDisk = canReuseWorktreesOnDiskFromState(workspaceForReuse, repos);

  const runAttemptsForState = await convex.query(api.runAttempts.list, { workspaceId });
  const hasCompletedSetup = hasCompletedSetupRunAttempt(runAttemptsForState);
  const effectiveResumed = hasPriorCodingRunAttempts(runAttemptsForState);

  if (canReuseWorktreesOnDisk) {
    console.log(
      `[lifecycle] reusing on-disk worktrees for workspace=${workspaceId} (skipping setup and worktree creation)`,
    );
  } else {
    console.log(`[lifecycle] preparing worktrees for workspace=${workspaceId}`);
  }

  const reposWithSetup = repos.filter((r) => r.setupScript);
  let setupRunAttemptId: Id<"runAttempts"> | undefined;
  let setupFlush: (() => Promise<void>) | undefined;
  let setupLogger: ScriptLogger | undefined;
  if (!canReuseWorktreesOnDisk && reposWithSetup.length > 0 && !hasCompletedSetup) {
    const promptLines = reposWithSetup.map((r) => `[${r.slug}]\n${r.setupScript}`);
    let storedPrompt = promptLines.join("\n\n");
    if (storedPrompt.length > MAX_SCRIPT_PROMPT_LEN) {
      storedPrompt = storedPrompt.slice(0, MAX_SCRIPT_PROMPT_LEN) + "\n\n... [truncated]";
    }
    const setupAttemptId = await convex.mutation(api.runAttempts.create, {
      workspaceId,
      type: "setup",
      prompt: storedPrompt,
    });
    setupRunAttemptId = setupAttemptId;
    const flusher = createScriptLogFlusher(convex, setupAttemptId, workspaceId);
    setupFlush = flusher.flush;
    setupLogger = flusher.logger;
  }

  let setupError: unknown;
  let worktrees!: WorktreeEntry[];
  let agentCwd!: string;
  /** True when reusing an existing feature branch (on-disk paths or git "branch already exists"). Used for experiment reset — not the same as `effectiveResumed` (coding prompt / session resume). */
  let branchExistedBeforeThisRun!: boolean;
  try {
    if (canReuseWorktreesOnDisk && workspaceForReuse) {
      worktrees = storedWts;
      agentCwd = workspaceForReuse.agentCwd;
      branchExistedBeforeThisRun = true;
    } else {
      const result = await worktreeManager.createWorktrees({
        workspaceId,
        simpleId: issue?.simpleId ?? workspaceId.slice(0, 8),
        issueTitle: issue?.title,
        repos,
        logger: setupLogger,
        skipSetup: hasCompletedSetup,
      });
      worktrees = result.worktrees;
      agentCwd = result.agentCwd;
      branchExistedBeforeThisRun = result.resumed;
    }
  } catch (err) {
    setupError = err;
    throw err;
  } finally {
    if (setupRunAttemptId) {
      await setupFlush?.();
      if (setupError !== undefined) {
        await convex.mutation(api.runAttempts.complete, {
          id: setupRunAttemptId,
          status: "failed",
          // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions
          error: setupError instanceof Error ? setupError.message : `${setupError}`,
        });
      } else {
        await convex.mutation(api.runAttempts.complete, {
          id: setupRunAttemptId,
          status: "succeeded",
          exitCode: 0,
        });
      }
    }
  }
  if (branchExistedBeforeThisRun) {
    console.log(
      `[lifecycle] feature branch already existed or on-disk worktrees reused for workspace=${workspaceId}`,
    );
  }

  // Before any planning/coding `runAgent` in this lifecycle — no coding runAttempt for this dispatch yet.
  let previousPlanningSessionId: string | undefined;
  try {
    const lastPlanning = await convex.query(api.runAttempts.lastSession, {
      workspaceId,
      type: "planning",
    });
    previousPlanningSessionId = lastPlanning?.sessionId;
  } catch { /* optional */ }

  let previousGrillingSessionId: string | undefined;
  try {
    const lastGrilling = await convex.query(api.runAttempts.lastSession, {
      workspaceId,
      type: "grilling",
    });
    previousGrillingSessionId = lastGrilling?.sessionId;
  } catch { /* optional */ }

  let previousCodingSessionId: string | undefined;
  if (effectiveResumed) {
    try {
      const lastCoding = await convex.query(api.runAttempts.lastSession, {
        workspaceId,
        type: "coding",
      });
      previousCodingSessionId = lastCoding?.sessionId;
      if (previousCodingSessionId) {
        console.log(
          `[lifecycle] prior coding session ${previousCodingSessionId} for workspace=${workspaceId}`,
        );
      }
    } catch { /* optional */ }
  }

  // Fetch current workspace to check plan/experiment state
  const currentWorkspace = await convex.query(api.workspaces.get, { id: workspaceId });

  // 1a. Reset worktree branches for new experiments (discard previous code)
  if ((currentWorkspace?.experimentNumber ?? 0) > 1 && branchExistedBeforeThisRun) {
    for (const wt of worktrees) {
      console.log(`[lifecycle] workspace=${workspaceId} resetting branch for experiment #${currentWorkspace?.experimentNumber}`);
      const resetResult = Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "reset", "--hard", wt.baseBranch],
        { timeout: 30000 },
      );
      if (resetResult.exitCode !== 0) {
        console.warn(`[lifecycle] workspace=${workspaceId} branch reset failed: ${resetResult.stderr.toString()}`);
      }
      // Clean untracked files
      Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "clean", "-fd"],
        { timeout: 10000 },
      );
    }
  }

  // 1b. Fetch project-level MCP server configs and skills for isolation
  let externalMcpConfigs: ExternalMcpConfig[] = [];
  const settingsPath = `/tmp/yes-kanban-settings-${workspaceId}.json`;
  let disableSlashCommands = true;
  let disableBuiltInMcp = false;
  try {
    const projectData = await convex.query(api.projects.get, { id: task.projectId });
    disableBuiltInMcp = projectData?.disableBuiltInMcp ?? false;
  } catch { /* project fetch is optional for this flag */ }
  try {
    const mcpConfigs = await convex.query(api.mcpServerConfigs.listEnabled, { projectId: task.projectId });
    externalMcpConfigs = mcpConfigs.map((c) => ({
      name: c.name,
      command: c.command,
      args: c.args,
      env: c.env,
    }));
    if (externalMcpConfigs.length > 0) {
      console.log(`[lifecycle] workspace=${workspaceId} loaded ${externalMcpConfigs.length} external MCP server(s)`);
    }
  } catch { /* external MCP configs are optional */ }

  let skills: Doc<"skills">[] = [];
  try {
    skills = await convex.query(api.skills.listEnabled, { projectId: task.projectId });
  } catch { /* skills fetch is optional */ }
  const hasSkills = skills.length > 0;
  const hasAllowedTools = (agentConfig.allowedToolPatterns ?? []).length > 0;
  if (hasSkills) disableSlashCommands = false;

  const settingsContent: Record<string, unknown> = {
    attribution: { commit: "", pr: "" },
  };
  if (hasSkills) {
    settingsContent["skills"] = skills.map((s) => ({
      name: s.name,
      description: s.description,
      content: s.content,
    }));
  }
  if (hasAllowedTools) {
    settingsContent["permissions"] = {
      allow: agentConfig.allowedToolPatterns,
    };
  }
  await Bun.write(settingsPath, JSON.stringify(settingsContent, null, 2));
  if (hasSkills) console.log(`[lifecycle] workspace=${workspaceId} loaded ${skills.length} skill(s)`);
  if (hasAllowedTools) console.log(`[lifecycle] workspace=${workspaceId} loaded ${agentConfig.allowedToolPatterns?.length ?? 0} allowed tool pattern(s)`);

  // Start MCP server if enabled
  let mcpServer: McpServer | null = null;
  let mcpConfigPath: string | undefined;

  if (agentConfig.mcpEnabled) {
    mcpServer = new McpServer(
      convex,
      task.projectId,
      workspaceId,
      issue?._id,
      agentConfig.mcpTools ?? null,
      externalMcpConfigs,
      disableBuiltInMcp,
    );
    const mcpResult = await mcpServer.start();
    mcpConfigPath = mcpResult.configPath;
    console.log(`[lifecycle] MCP server started on port ${mcpResult.port} for workspace=${workspaceId}`);

    // Clean up any stale .cursor/ dirs from previous runs (e.g., worktree reuse with different agent)
    for (const wt of worktrees) {
      const cursorDir = join(wt.worktreePath, ".cursor");
      if (agentConfig.agentType !== "cursor" && existsSync(cursorDir)) {
        try { rmSync(cursorDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }

    // Cursor auto-detects MCP from .cursor/mcp.json in the workspace.
    // Copy the generated config there so Cursor picks it up.
    if (agentConfig.agentType === "cursor" && mcpConfigPath && worktrees.length > 0) {
      for (const wt of worktrees) {
        try {
          const cursorDir = join(wt.worktreePath, ".cursor");
          mkdirSync(cursorDir, { recursive: true });
          const mcpConfig = readFileSync(mcpConfigPath, "utf-8");
          writeFileSync(join(cursorDir, "mcp.json"), mcpConfig);

          // Add .cursor/ to git exclude so it's not committed
          const dotGit = join(wt.worktreePath, ".git");
          let excludePath = join(dotGit, "info", "exclude");
          try {
            const stat = statSync(dotGit);
            if (stat.isFile()) {
              // Worktree: .git is a file containing "gitdir: <path>"
              const content = readFileSync(dotGit, "utf-8").trim();
              if (content.startsWith("gitdir:")) {
                const gitdir = resolve(wt.worktreePath, content.slice("gitdir:".length).trim());
                excludePath = join(gitdir, "info", "exclude");
              }
            }
            // If .git is a directory, the default excludePath is already correct
          } catch { /* .git missing — fall back to default */ }
          const excludeContent = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
          if (!excludeContent.includes(".cursor/")) {
            mkdirSync(dirname(excludePath), { recursive: true });
            appendFileSync(excludePath, "\n.cursor/\n");
          }
          console.log(`[lifecycle] wrote .cursor/mcp.json for workspace=${workspaceId}`);
        } catch (err) {
          console.warn(`[lifecycle] failed to write .cursor/mcp.json:`, err);
        }
      }
    }
  }

  // Fetch attachments for the issue (if any)
  let attachments: AttachmentInfo[] | undefined;
  if (task.issueId) {
    try {
      const rawAttachments = await convex.query(api.attachments.list, { issueId: task.issueId });
      attachments = rawAttachments
        .filter(
          (a): a is Omit<typeof a, "url"> & { url: string } =>
            typeof a.url === "string" && a.url.trim().length > 0,
        )
        .map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, url: a.url.trim() }));
      if (attachments.length === 0) attachments = undefined;
    } catch { /* attachments are optional */ }
  }

  // Download attachments to the worktree so the agent can access them via Read
  if (attachments && attachments.length > 0 && worktrees.length > 0) {
    const firstWt = worktrees[0];
    if (firstWt) {
      try {
        await downloadAttachments(attachments, firstWt.worktreePath);
        console.log(`[lifecycle] workspace=${workspaceId} downloaded ${attachments.filter((a) => a.localPath).length}/${attachments.length} attachments`);
      } catch (err) {
        console.warn(`[lifecycle] workspace=${workspaceId} attachment download failed:`, err);
      }
    }
  }

  // 1c. Planning stage (if not skipped and no approved plan yet)
  const skipPlanning = project?.skipPlanning ?? true;
  const planningTools = issue?.deepResearch ? PLANNING_RESEARCH_TOOLS : PLANNING_TOOLS;
  const planApproved = currentWorkspace?.planApproved ?? false;
  const grillingComplete = currentWorkspace?.grillingComplete === true;

  /** When grilling finishes in this run, planning resumes the same agent session. */
  let planningSessionFromGrill: string | undefined;

  // 1b. Grill Me — pre-planning interview (optional)
  if (!skipPlanning && !planApproved && issue?.grillMe && !grillingComplete) {
    if (!(await waitForPhaseCapacity(convex, workspaceId, "planning", abortSignal))) return;
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "grilling",
      worktrees,
      agentCwd,
    });

    const questionsForGrill = await convex.query(api.agentQuestions.list, { workspaceId });
    const answeredForGrill = questionsForGrill
      .filter((q) => q.status === "answered" && q.answer)
      .map((q) => ({ question: q.question, answer: q.answer ?? "" }));

    const grillingTemplate = await convex.query(api.promptTemplates.resolve, {
      projectId: task.projectId,
      type: "grilling" as const,
    });

    const isResumingGrilling =
      !!previousGrillingSessionId && answeredForGrill.length > 0;

    const grillingPrompt = buildGrillingPrompt(
      issue,
      worktrees,
      answeredForGrill,
      attachments,
      grillingTemplate?.content,
      isResumingGrilling,
    );

    const grillingPlanningConfigId = project?.planningAgentConfigId ?? agentConfig._id;
    const grillingAgentConfig = grillingPlanningConfigId !== agentConfig._id
      ? (await convex.query(api.agentConfigs.get, { id: grillingPlanningConfigId })) ?? agentConfig
      : agentConfig;

    const grillResult = await runAgent(
      convex, config, executor, workspaceId, grillingAgentConfig, agentCwd,
      grillingPrompt, "grilling", abortSignal,
      {
        mcpConfigPath, mcpServer, permissionMode: "plan", sessionId: previousGrillingSessionId,
        settingsPath, disableSlashCommands,
        allowedTools: GRILLING_TOOLS,
      },
    );

    if (abortSignal.aborted) return;

    if (!grillResult.success) {
      await handleFailure(convex, config, workspaceId, grillingAgentConfig, grillResult, worktrees, issue);
      if (mcpServer) { mcpServer.stop(); }
      return;
    }

    const agentAskedQuestionGrill = grillResult.events.some(
      (e) => e.type === "tool_use" && (e.data as { name?: string }).name === "mcp__yes-kanban__ask_question",
    );

    if (agentAskedQuestionGrill) {
      await convex.mutation(api.workspaces.updateStatus, {
        id: workspaceId,
        status: "waiting_for_answer",
      });
      console.log(`[lifecycle] workspace=${workspaceId} grilling paused for user answer`);
      if (mcpServer) { mcpServer.stop(); }
      return;
    }

    planningSessionFromGrill = grillResult.sessionId;
  }

  if (!skipPlanning && !planApproved) {
    if (!(await waitForPhaseCapacity(convex, workspaceId, "planning", abortSignal))) return;
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "planning",
      worktrees,
      agentCwd,
      ...(planningSessionFromGrill !== undefined ? { grillingComplete: true } : {}),
    });

    // Gather any previously answered questions
    const questions = await convex.query(api.agentQuestions.list, { workspaceId });
    const answeredQuestions = questions
      .filter((q) => q.status === "answered" && q.answer)
      .map((q) => ({ question: q.question, answer: q.answer ?? "" }));

    // Fetch pending feedback messages so the agent sees user's plan feedback
    const pendingFeedback = await convex.query(api.feedbackMessages.listPending, { workspaceId });

    const planningResumeSessionId = planningSessionFromGrill ?? previousPlanningSessionId;

    // When resuming a planning session (questions answered or feedback given),
    // send a concise continuation prompt instead of repeating the full context.
    // Use only `previousPlanningSessionId` here — transitioning from grilling with Q&A
    // should still use the full planning prompt (grill context is in answeredQuestions).
    const isResumingPlanning =
      previousPlanningSessionId &&
      (answeredQuestions.length > 0 || pendingFeedback.length > 0);
    let planningPrompt: string;

    if (isResumingPlanning) {
      const parts: string[] = ["The user has provided responses. Continue planning:"];
      if (answeredQuestions.length > 0) {
        parts.push("\n## Answered Questions");
        for (const qa of answeredQuestions) {
          parts.push(`\n**Q:** ${qa.question}`);
          parts.push(`**A:** ${qa.answer}`);
        }
      }
      if (pendingFeedback.length > 0 && currentWorkspace?.plan) {
        parts.push("\n## User Feedback on Plan");
        for (const fb of pendingFeedback) {
          parts.push(`\n${fb.body}`);
        }
        parts.push("\n**Address this feedback and submit a revised plan using `mcp__yes-kanban__submit_plan`.**");
      }
      if (!currentWorkspace?.plan) {
        parts.push("\nNow create your implementation plan and submit it using `mcp__yes-kanban__submit_plan`.");
      } else {
        parts.push("\nRevise your plan based on the above and resubmit using `mcp__yes-kanban__submit_plan`.");
      }
      planningPrompt = parts.join("\n");
    } else {
      planningPrompt = buildPlanningPrompt(
        issue, worktrees, currentWorkspace?.plan ?? undefined, answeredQuestions,
        pendingFeedback.map((m) => m.body),
        undefined, issue?.deepResearch, attachments,
      );
    }

    // Resolve planning-specific agent config (falls back to default agent)
    const planningConfigId = project?.planningAgentConfigId ?? agentConfig._id;
    const planningAgentConfig = planningConfigId !== agentConfig._id
      ? (await convex.query(api.agentConfigs.get, { id: planningConfigId })) ?? agentConfig
      : agentConfig;

    const planResult = await runAgent(
      convex, config, executor, workspaceId, planningAgentConfig, agentCwd,
      planningPrompt, "planning", abortSignal,
      {
        mcpConfigPath, mcpServer, permissionMode: "plan", sessionId: planningResumeSessionId,
        settingsPath, disableSlashCommands,
        allowedTools: planningTools,
      },
    );

    if (abortSignal.aborted) return; // cancelled — status already set by worker

    if (!planResult.success) {
      await handleFailure(convex, config, workspaceId, planningAgentConfig, planResult, worktrees, issue);
      if (mcpServer) { mcpServer.stop(); }
      return;
    }

    /** Latest planning session for replanning — must not use DB `previousPlanningSessionId` (stale). YES-250 */
    let currentPlanningSessionId: string | undefined = planResult.sessionId;

    // Mark feedback as delivered only after the agent has successfully processed it.
    // Only mark if there was an existing plan — without one, feedback is not surfaced
    // in the prompt and should remain pending for the next planning cycle.
    const existingPlan = currentWorkspace?.plan ?? undefined;
    if (pendingFeedback.length > 0 && existingPlan) {
      await convex.mutation(api.feedbackMessages.markBatchDelivered, {
        ids: pendingFeedback.map((m) => m._id),
      });
    }

    // Safety net: if the planning agent succeeded but forgot to call submit_plan,
    // resume the session and ask it to submit the plan via the MCP tool.
    // Skip if the agent deliberately asked a question — it will resume after the user answers.
    const agentCalledSubmitPlan = planResult.events.some(
      (e) => e.type === "tool_use" && (e.data as { name?: string }).name === "mcp__yes-kanban__submit_plan",
    );
    const agentAskedQuestion = planResult.events.some(
      (e) => e.type === "tool_use" && (e.data as { name?: string }).name === "mcp__yes-kanban__ask_question",
    );
    // If the agent asked questions, check whether any are still pending.
    // If so, park the workspace in "waiting_for_answer" until the user responds.
    if (agentAskedQuestion) {
      const pendingQs = await convex.query(api.agentQuestions.listPending, { workspaceId });
      if (pendingQs.length > 0) {
        await convex.mutation(api.workspaces.updateStatus, {
          id: workspaceId,
          status: "waiting_for_answer",
        });
        console.log(`[lifecycle] workspace=${workspaceId} agent asked ${pendingQs.length} question(s), waiting for answers`);
        if (mcpServer) { mcpServer.stop(); }
        return;
      }
    }

    if (!agentCalledSubmitPlan && !agentAskedQuestion) {
      console.log(`[lifecycle] workspace=${workspaceId} agent did not call submit_plan, resuming session to request it`);
      const resumeSessionId = planResult.events
        .filter((e) => e.type === "system")
        .map((e) => (e.data as { session_id?: string }).session_id)
        .find(Boolean);

      const submitReminder = "You completed your planning but forgot to submit the plan. " +
        "Call `mcp__yes-kanban__submit_plan` now with the full implementation plan you created. " +
        "Do NOT do any more research — just submit what you already have.";

      const retryResult = await runAgent(
        convex, config, executor, workspaceId, planningAgentConfig, agentCwd,
        submitReminder, "planning", abortSignal,
        { mcpConfigPath, mcpServer, permissionMode: "plan", sessionId: resumeSessionId, settingsPath, disableSlashCommands, allowedTools: planningTools },
      );

      if (abortSignal.aborted) return; // eslint-disable-line @typescript-eslint/no-unnecessary-condition

      if (!retryResult.success) {
        console.log(`[lifecycle] workspace=${workspaceId} submit_plan retry failed`);
      } else {
        currentPlanningSessionId = retryResult.sessionId;
      }
    }

    // After planning agent finishes, either run AI plan review or wait for user
    if (project?.autoPlanReview) {
      const planReviewTemplate = await convex.query(api.promptTemplates.resolve, {
        projectId: task.projectId,
        type: "plan_review" as const,
      });
      // Reuse the code review agent config for plan review — the review prompt
      // and permission mode ensure appropriate behavior regardless of model config.
      const reviewConfigId = project.reviewAgentConfigId ?? agentConfig._id;
      const reviewConfig = await convex.query(api.agentConfigs.get, { id: reviewConfigId });

      if (reviewConfig) {
        let planReviewCycles = 0;
        const maxCycles = project.maxReviewCycles;
        let planAutoApproved = false;

        while (planReviewCycles < maxCycles) {
          // Re-fetch workspace to get latest plan text
          const ws = await convex.query(api.workspaces.get, { id: workspaceId });
          const currentPlan = ws?.plan;
          if (!currentPlan) break;

          await convex.mutation(api.workspaces.updateStatus, {
            id: workspaceId,
            status: "plan_reviewing",
          });

          const planReviewPrompt = buildPlanReviewPrompt(
            issue, currentPlan, planReviewTemplate?.content, attachments,
          );

          const reviewResult = await runAgent(
            convex, config, executor, workspaceId, reviewConfig, agentCwd,
            planReviewPrompt, "plan_review", abortSignal,
            { mcpConfigPath, mcpServer, permissionMode: "plan", settingsPath, disableSlashCommands, allowedTools: READ_ONLY_TOOLS },
          );

          if (!reviewResult.success) {
            if (abortSignal.aborted) return; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
            break; // review agent failed, fall through to user review
          }

          const verdict = extractPlanReviewVerdict(reviewResult.events);
          console.log(`[lifecycle] workspace=${workspaceId} plan review verdict: ${verdict}`);

          let effectiveVerdict = verdict;
          let effectiveEvents = reviewResult.events;

          if (verdict !== "APPROVE" && verdict !== "REQUEST_CHANGES" && verdict !== "RESTART") {
            console.log(`[lifecycle] workspace=${workspaceId} unknown plan review verdict, asking agent to clarify`);
            const clarifyPrompt =
              "Your plan review is missing a verdict. You MUST end your response with exactly one of:\n\n" +
              "FINAL_VERDICT: APPROVE\n" +
              "FINAL_VERDICT: REQUEST_CHANGES — <reason>\n" +
              "FINAL_VERDICT: RESTART — <reason>\n\n" +
              "Please provide your FINAL_VERDICT now.";
            const clarifyResult = await runAgent(
              convex, config, executor, workspaceId, reviewConfig, agentCwd,
              clarifyPrompt, "plan_review", abortSignal,
              {
                mcpConfigPath, mcpServer, permissionMode: "plan", sessionId: reviewResult.sessionId,
                settingsPath, disableSlashCommands, allowedTools: READ_ONLY_TOOLS,
              },
            );
            if (abortSignal.aborted) return; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
            if (clarifyResult.success) {
              effectiveVerdict = extractPlanReviewVerdict(clarifyResult.events);
              effectiveEvents = clarifyResult.events;
              console.log(`[lifecycle] workspace=${workspaceId} clarified plan review verdict: ${effectiveVerdict}`);
            }
          }

          if (effectiveVerdict === "APPROVE") {
            planAutoApproved = true;
            break;
          }

          if (effectiveVerdict === "RESTART") {
            console.log(`[lifecycle] workspace=${workspaceId} plan review: RESTART, falling back to user`);
            break;
          }

          if (effectiveVerdict === "REQUEST_CHANGES") {
            planReviewCycles++;
            const feedback = extractAssistantText(effectiveEvents);

            if (planReviewCycles >= maxCycles) {
              console.log(`[lifecycle] workspace=${workspaceId} max plan review cycles reached`);
              break;
            }

            // Re-run planning agent with review feedback
            if (!(await waitForPhaseCapacity(convex, workspaceId, "planning", abortSignal))) return;
            await convex.mutation(api.workspaces.updateStatus, {
              id: workspaceId,
              status: "planning",
            });

            const questions = await convex.query(api.agentQuestions.list, { workspaceId });
            const answeredQs = questions
              .filter((q) => q.status === "answered" && q.answer)
              .map((q) => ({ question: q.question, answer: q.answer ?? "" }));
            const pendingFb = await convex.query(api.feedbackMessages.listPending, { workspaceId });

            const replanPrompt = buildPlanningPrompt(
              issue, worktrees, ws.plan, answeredQs,
              pendingFb.map((m) => m.body), feedback, issue?.deepResearch, attachments,
            );

            const replanResult = await runAgent(
              convex, config, executor, workspaceId, planningAgentConfig, agentCwd,
              replanPrompt, "planning", abortSignal,
              { mcpConfigPath, mcpServer, permissionMode: "plan", sessionId: currentPlanningSessionId, settingsPath, disableSlashCommands, allowedTools: planningTools },
            );

            if (!replanResult.success) {
              if (abortSignal.aborted) return; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
              break; // planning agent failed, fall through to user review
            }

            currentPlanningSessionId = replanResult.sessionId;

            if (abortSignal.aborted) return; // eslint-disable-line @typescript-eslint/no-unnecessary-condition

            // If the replan agent asked questions, wait for answers before continuing the review loop
            const replanPendingQs = await convex.query(api.agentQuestions.listPending, { workspaceId });
            if (replanPendingQs.length > 0) {
              await convex.mutation(api.workspaces.updateStatus, {
                id: workspaceId,
                status: "waiting_for_answer",
              });
              console.log(`[lifecycle] workspace=${workspaceId} replan agent asked ${replanPendingQs.length} question(s), waiting for answers`);
              if (mcpServer) { mcpServer.stop(); }
              return;
            }

            continue;
          }

          // UNKNOWN verdict — fall through to user review
          break;
        }

        if (planAutoApproved) {
          await convex.mutation(api.workspaces.approvePlan, { id: workspaceId });
          console.log(`[lifecycle] workspace=${workspaceId} plan auto-approved by reviewer`);
          if (mcpServer) { mcpServer.stop(); }
          return; // lifecycle will restart with planApproved=true
        }
      }
    }

    // Fall through: set to awaiting_feedback for user review
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "awaiting_feedback",
    });

    console.log(`[lifecycle] workspace=${workspaceId} planning complete, awaiting plan approval`);
    if (mcpServer) { mcpServer.stop(); }
    return; // Lifecycle pauses here — user approves plan, then workspace restarts
  }

  // Rebase onto latest base branch before coding — critical when multiple
  // workspaces run in parallel and main has moved since planning.
  if (planApproved && worktrees.length > 0) {
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "rebasing",
    });
    console.log(`[lifecycle] workspace=${workspaceId} rebasing before coding`);

    const rebaseTpl = await convex.query(api.promptTemplates.resolve, {
      projectId: task.projectId,
      type: "rebase",
    });
    const rebaseResult = await executeRebase(
      convex, config, executor, workspaceId, agentConfig,
      worktrees, abortSignal, rebaseTpl?.content,
    );

    if (abortSignal.aborted) return;
    if (rebaseResult === "conflict") {
      await convex.mutation(api.workspaces.updateStatus, {
        id: workspaceId,
        status: "conflict",
      });
      if (mcpServer) { mcpServer.stop(); }
      return;
    }

    await convex.mutation(api.workspaces.updateBranchStatus, {
      id: workspaceId,
      behindMainBy: 0,
    });
    console.log(`[lifecycle] workspace=${workspaceId} rebase complete, proceeding to coding`);
  }

  if (!(await waitForPhaseCapacity(convex, workspaceId, "coding", abortSignal))) return;
  await convex.mutation(api.workspaces.updateStatus, {
    id: workspaceId,
    status: "coding",
    worktrees,
    agentCwd,
  });

  // Start live diff polling so the UI can show changes as they happen
  const stopDiffPolling = startDiffPolling(convex, worktreeManager, workspaceId, worktrees);

  try {
  // Track the latest coding session ID so review-fix cycles resume the correct session
  let lastCodingSessionId: string | undefined = previousCodingSessionId;

  // 2. Coding stage — or fix cycle if retrying from changes_requested
  // When reviewRequested is set, skip coding — go straight to review (tests run after review)
  const reviewRequested = currentWorkspace?.reviewRequested;
  if (reviewRequested) {
    console.log(`[lifecycle] workspace=${workspaceId} review requested — skipping coding`);
    if (!(await waitForPhaseCapacity(convex, workspaceId, "reviewing", abortSignal))) return;
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId, status: "reviewing",
    });
    // Clear the flag so future retries don't skip coding
    await convex.mutation(api.workspaces.clearReviewRequested, {
      id: workspaceId,
    });
  }

  const reviewFeedback = currentWorkspace?.reviewFeedback;
  if (!reviewRequested && reviewFeedback) {
    // Retry from changes_requested: skip initial coding, run fix with review feedback
    console.log(`[lifecycle] workspace=${workspaceId} resuming with review feedback`);
    const fixPrompt = buildFixPrompt(reviewFeedback);
    const fixResult = await runAgent(
      convex, config, executor, workspaceId, agentConfig, agentCwd,
      fixPrompt, "coding", abortSignal,
      { mcpConfigPath, mcpServer, sessionId: previousCodingSessionId, settingsPath, disableSlashCommands, allowedTools: CODING_TOOLS,
        permissionMode: agentConfig.permissionMode === "accept" ? "accept" : undefined,
        agentConfigId: agentConfig._id },
    );
    lastCodingSessionId = fixResult.sessionId;

    // Clear review feedback now that fix has been attempted
    await convex.mutation(api.workspaces.clearReviewFeedback, {
      id: workspaceId,
    });

    if (abortSignal.aborted) return; // cancelled — status already set by worker

    if (!fixResult.success) {
      stopDiffPolling();
      await handleFailure(convex, config, workspaceId, agentConfig, fixResult, worktrees, issue);
      return;
    }
  } else if (!reviewRequested) {
    // Normal initial coding
    const codingResult = await runAgent(
      convex, config, executor, workspaceId, agentConfig, agentCwd,
      buildPrompt(issue, task.additionalPrompt, worktrees, effectiveResumed, currentWorkspace?.lastError ?? undefined,
        workflowTemplate?.content, attachments,
        currentWorkspace?.plan ?? undefined, currentWorkspace?.experimentNumber ?? undefined),
      "coding", abortSignal, { mcpConfigPath, mcpServer, sessionId: previousCodingSessionId, settingsPath, disableSlashCommands, allowedTools: CODING_TOOLS,
        permissionMode: agentConfig.permissionMode === "accept" ? "accept" : undefined,
        agentConfigId: agentConfig._id },
    );
    lastCodingSessionId = codingResult.sessionId;

    if (abortSignal.aborted) return; // cancelled — status already set by worker

    if (!codingResult.success) {
      stopDiffPolling();
      await handleFailure(convex, config, workspaceId, agentConfig, codingResult, worktrees, issue);
      return;
    }

    // Check if there are actual file changes before proceeding to test/review/PR
    let noFileChanges = false;
    if (worktrees.length > 0) {
      const firstWt = worktrees[0];
      if (firstWt) {
        const earlyDiff = await worktreeManager.getDiff(firstWt.worktreePath, firstWt.baseBranch);
        noFileChanges = !hasFileChanges(earlyDiff);
      }
    }

    if (noFileChanges) {
      console.log(`[lifecycle] workspace=${workspaceId} no file changes, skipping tests/review/PR`);
      await convex.mutation(api.workspaces.updateStatus, {
        id: workspaceId, status: "completed", completedAt: Date.now(),
      });
      await convex.mutation(api.workspaces.updateStatus, {
        id: workspaceId, status: "merged",
      });
      // Clean up worktrees immediately — nothing to preserve
      try {
        await removeWorktreesWithOptionalScriptLogs(
          convex, worktreeManager, workspaceId, worktrees, repos,
        );
        await convex.mutation(api.workspaces.clearWorktrees, { id: workspaceId });
        console.log(`[lifecycle] workspace=${workspaceId} worktrees cleaned up (no file changes)`);
      } catch (cleanupErr) {
        console.error(`[lifecycle] workspace=${workspaceId} worktree cleanup failed:`, cleanupErr);
      }
      return;
    }
  }

  const issueRef = issue?.simpleId ?? "WIP";
  if (!reviewRequested) {
    // Auto-commit any uncommitted changes the agent left behind
    for (const wt of worktrees) {
      if (commitUnstagedChanges(wt.worktreePath, issueRef)) {
        console.log(`[lifecycle] workspace=${workspaceId} auto-committed uncommitted changes in ${wt.worktreePath}`);
      }
    }
  }

  // 3. Review stage (if configured)
  if (project?.skipReview || !project) {
    console.log(`[lifecycle] workspace=${workspaceId} skipping review (${project?.skipReview ? "project settings" : "no project"})`);
  }
  if (!project?.skipReview && project) {
    const reviewConfigId = project.reviewAgentConfigId ?? agentConfig._id;
    const reviewConfig = await convex.query(api.agentConfigs.get, { id: reviewConfigId });

    if (reviewConfig) {
      let reviewCycles = 0;
      const maxCycles = project.maxReviewCycles;

      while (reviewCycles < maxCycles) {
        if (!(await waitForPhaseCapacity(convex, workspaceId, "reviewing", abortSignal))) return;
        await convex.mutation(api.workspaces.updateStatus, {
          id: workspaceId, status: "reviewing",
        });

        const firstWt = worktrees[0];
        if (!firstWt) throw new Error("No worktrees available for review");
        const diff = await worktreeManager.getDiff(
          firstWt.worktreePath, firstWt.baseBranch
        );
        const reviewPrompt = buildReviewPrompt(issue, diff, reviewTemplate?.content, attachments);

        // Review agents use plan mode — they only need to read, not write
        const reviewResult = await runAgent(
          convex, config, executor, workspaceId, reviewConfig, agentCwd,
          reviewPrompt, "review", abortSignal,
          { mcpConfigPath, mcpServer, permissionMode: "plan", settingsPath, disableSlashCommands, allowedTools: REVIEW_TOOLS },
        );

        if (!reviewResult.success) {
          if (abortSignal.aborted) return; // cancelled
          // Review agent failed (crash, timeout, etc.) — don't fall through to completed
          await convex.mutation(api.workspaces.updateStatus, {
            id: workspaceId, status: "failed", completedAt: Date.now(),
          });
          console.log(`[lifecycle] workspace=${workspaceId} review agent failed`);
          return;
        }

        // Parse review verdict from structured assistant messages
        const verdict = extractReviewVerdict(reviewResult.events);
        console.log(`[lifecycle] workspace=${workspaceId} review verdict: ${verdict}`);

        let effectiveVerdict = verdict;
        let feedbackEvents = reviewResult.events;

        if (verdict !== "APPROVE" && verdict !== "CONCERN" && verdict !== "REQUEST_CHANGES") {
          // UNKNOWN verdict — ask agent to clarify with a structured verdict
          console.log(`[lifecycle] workspace=${workspaceId} unknown review verdict, asking agent to clarify`);
          const clarifyPrompt = "Your review is missing a verdict. You MUST end your response with exactly one of:\n\nFINAL_VERDICT: APPROVE\nFINAL_VERDICT: CONCERN — <reason>\nFINAL_VERDICT: REQUEST_CHANGES — <reason>\n\nPlease provide your FINAL_VERDICT now.";
          const clarifyResult = await runAgent(
            convex, config, executor, workspaceId, reviewConfig, agentCwd,
            clarifyPrompt, "review", abortSignal,
            { mcpConfigPath, mcpServer, permissionMode: "plan", sessionId: reviewResult.sessionId, settingsPath, disableSlashCommands, allowedTools: REVIEW_TOOLS },
          );
          if (abortSignal.aborted) return;
          if (clarifyResult.success) {
            effectiveVerdict = extractReviewVerdict(clarifyResult.events);
            console.log(`[lifecycle] workspace=${workspaceId} clarified review verdict: ${effectiveVerdict}`);
            feedbackEvents = clarifyResult.events;
          }
          if (effectiveVerdict !== "APPROVE" && effectiveVerdict !== "CONCERN" && effectiveVerdict !== "REQUEST_CHANGES") {
            // Still unknown after clarification — surface to user
            const unknownFeedback = extractAssistantText(feedbackEvents);
            await convex.mutation(api.workspaces.updateStatus, {
              id: workspaceId, status: "changes_requested",
              reviewFeedback: unknownFeedback || "Review completed but verdict could not be determined.",
            });
            console.log(`[lifecycle] workspace=${workspaceId} verdict still unknown after clarification — waiting for user`);
            return;
          }
        }

        if (effectiveVerdict === "APPROVE") {
          break;
        }

        // CONCERN or REQUEST_CHANGES — run fix cycle
        reviewCycles++;

        // Extract feedback before checking max cycles — needed for both paths
        const feedback = extractAssistantText(feedbackEvents);

        if (reviewCycles >= maxCycles) {
          // Store review feedback so retry can resume with context
          await convex.mutation(api.workspaces.updateStatus, {
            id: workspaceId, status: "changes_requested", reviewFeedback: feedback,
          });
          console.log(`[lifecycle] max review cycles reached for workspace=${workspaceId}`);
          return;
        }

        // Re-run coding with feedback, resuming the coding session
        if (!(await waitForPhaseCapacity(convex, workspaceId, "coding", abortSignal))) return;
        await convex.mutation(api.workspaces.updateStatus, {
          id: workspaceId, status: "coding",
        });
        const fixPrompt = buildFixPrompt(feedback);
        const fixResult = await runAgent(
          convex, config, executor, workspaceId, agentConfig, agentCwd,
          fixPrompt, "coding", abortSignal,
          { mcpConfigPath, mcpServer, sessionId: lastCodingSessionId, settingsPath, disableSlashCommands, allowedTools: CODING_TOOLS,
            permissionMode: agentConfig.permissionMode === "accept" ? "accept" : undefined,
            agentConfigId: agentConfig._id },
        );
        // Update session ID so the next fix cycle resumes from this fix, not the original
        lastCodingSessionId = fixResult.sessionId;
        if (!fixResult.success) {
          if (abortSignal.aborted) return; // cancelled
          await handleFailure(convex, config, workspaceId, agentConfig, fixResult, worktrees, issue);
          return;
        }

        // Auto-commit any uncommitted changes after fix
        for (const wt of worktrees) {
          if (commitUnstagedChanges(wt.worktreePath, issueRef)) {
            console.log(`[lifecycle] workspace=${workspaceId} auto-committed after fix cycle`);
          }
        }
      }
    }
  }

  // 4. Testing stage (if configured) — after review approval (or when review is skipped)
  if (project?.skipTests) {
    console.log(`[lifecycle] workspace=${workspaceId} skipping tests (project settings)`);
  }
  if (!project?.skipTests) {
    console.log(`[lifecycle] workspace=${workspaceId} running tests`);
    if (!(await waitForPhaseCapacity(convex, workspaceId, "testing", abortSignal))) return;
    const twf = await runTestsWithFix(
      convex, config, executor, workspaceId, agentConfig, agentCwd,
      repos, worktrees, abortSignal, lastCodingSessionId,
      mcpConfigPath, mcpServer, settingsPath, disableSlashCommands, issueRef, issue,
    );
    if (abortSignal.aborted) return;
    if (twf === null) return;
    if (!twf.ok) {
      if (twf.kind === "tests_failed") {
        await convex.mutation(api.workspaces.updateStatus, {
          id: workspaceId, status: "test_failed",
        });
        console.log(`[lifecycle] tests failed for workspace=${workspaceId}`);
      }
      return;
    }
    lastCodingSessionId = twf.lastCodingSessionId;
  }
  } finally {
    stopDiffPolling();
    if (mcpServer) {
      mcpServer.stop();
      console.log(`[lifecycle] MCP server stopped for workspace=${workspaceId}`);
    }
    // Clean up temporary settings file to avoid stale permissions/skills on re-runs
    try { await unlink(settingsPath); } catch { /* best-effort */ }
  }

  // Collect diff output before rebasing (while worktrees are still clean)
  let diffOutput: string | undefined;
  if (worktrees.length > 0) {
    try {
      const firstWt = worktrees[0];
      if (!firstWt) throw new Error("No worktrees available for diff");
      diffOutput = await worktreeManager.getDiff(
        firstWt.worktreePath, firstWt.baseBranch
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lifecycle] failed to collect diff for workspace=${workspaceId}:`, message);
    }
  }

  // 5. Local merge (if configured on project or issue) — rebase first, then squash merge
  if (shouldLocalMerge(project, issue)) {
    // Rebase onto base branch, using agent for conflict resolution if needed
    console.log(`[lifecycle] workspace=${workspaceId} rebasing before local merge`);
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId, status: "rebasing",
    });
    const rebaseTpl = await convex.query(api.promptTemplates.resolve, {
      projectId: task.projectId,
      type: "rebase",
    });
    const rebaseResult = await executeRebase(
      convex, config, executor, workspaceId, agentConfig,
      worktrees, abortSignal, rebaseTpl?.content,
    );
    if (abortSignal.aborted) return;
    if (rebaseResult === "conflict") {
      await convex.mutation(api.workspaces.updateStatus, {
        id: workspaceId, status: "conflict",
      });
      return;
    }

    console.log(`[lifecycle] workspace=${workspaceId} performing local squash merge`);
    const mergeResult = performLocalMerge(worktrees);
    if (!mergeResult.success) {
      console.error(`[lifecycle] workspace=${workspaceId} local merge failed: ${mergeResult.error}`);
      await convex.mutation(api.workspaces.updateStatus, {
        id: workspaceId, status: "merge_failed", completedAt: Date.now(),
      });
      return;
    }
    const pushResult = pushBaseBranch(worktrees);
    if (!pushResult.success) {
      console.warn(`[lifecycle] push after merge failed: ${pushResult.error}`);
    }
    console.log(`[lifecycle] workspace=${workspaceId} merged locally`);
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId, status: "merged", completedAt: Date.now(), diffOutput,
    });

    // Clean up worktrees immediately after merge
    try {
      await removeWorktreesWithOptionalScriptLogs(
        convex, worktreeManager, workspaceId, worktrees, repos,
      );
      await convex.mutation(api.workspaces.clearWorktrees, { id: workspaceId });
      console.log(`[lifecycle] workspace=${workspaceId} worktrees cleaned up`);
    } catch (cleanupErr) {
      console.error(`[lifecycle] workspace=${workspaceId} worktree cleanup failed:`, cleanupErr);
    }
    return;
  }

  // 6. Mark as complete — PR creation and merge are triggered manually from the UI
  console.log(`[lifecycle] workspace=${workspaceId} completed`);
  await convex.mutation(api.workspaces.updateStatus, {
    id: workspaceId, status: "completed", completedAt: Date.now(), diffOutput,
  });
}

/**
 * Create a PR for a completed workspace. Triggered manually from the UI.
 */
export async function executeCreatePR(
  workspaceId: Id<"workspaces">,
  worktrees: WorktreeEntry[],
  issue?: { title: string; description: string } | null,
): Promise<"success" | "failed"> {
  const forge = getForgeAdapter("github");
  const availability = await forge.checkAvailability();

  if (!availability.available) {
    console.error(`[lifecycle] workspace=${workspaceId} forge not available: ${availability.error}`);
    return "failed";
  }

  for (const wt of worktrees) {
    try {
      const { url } = await forge.createPullRequest({
        worktreePath: wt.worktreePath,
        repoPath: wt.repoPath,
        baseBranch: wt.baseBranch,
        branch: wt.branchName,
        title: issue?.title ?? "Changes from Yes Kanban",
        body: issue?.description ?? "",
      });
      console.log(`[lifecycle] PR created: ${url}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[lifecycle] PR creation failed:`, message);
      return "failed";
    }
  }
  return "success";
}

/**
 * Serialize and truncate tool input for DB storage.
 * The result is stored as a plain string field (not parsed as JSON),
 * so truncation mid-serialization is safe for display purposes.
 */
function truncateToolInput(input: unknown, maxLen: number): string {
  const full = typeof input === "string" ? input : JSON.stringify(input);
  if (full.length <= maxLen) return full;
  return full.slice(0, maxLen) + "…[truncated]";
}

/**
 * Handle a single permission request: persist to DB, poll for user response,
 * write result to stdin, and optionally persist "always allow" patterns.
 *
 * The returned promise resolves when the permission is resolved (approved/rejected),
 * when the process exits, or on creation failure. Callers use fire-and-forget (`void`)
 * but the promise is well-defined if awaited.
 */
function handlePermissionRequest(args: {
  convex: ConvexClient;
  workspaceId: Id<"workspaces">;
  runAttemptId: Id<"runAttempts">;
  reqId: string;
  toolName: string;
  inputStr?: string;
  stdinReady: Promise<(data: string) => void>;
  activePollerTimers: Set<ReturnType<typeof setTimeout>>;
  agentConfigId?: Id<"agentConfigs">;
  onResolved: () => void;
  isExited: () => boolean;
  formatPermissionResponse: (requestId: string, approved: boolean) => string;
}): Promise<void> {
  const { convex, workspaceId, runAttemptId, reqId, toolName, inputStr } = args;

  // Guard against multiple onResolved calls (e.g., process exits mid-poll)
  let resolved = false;
  const resolveOnce = (settle: () => void) => {
    if (resolved) return;
    resolved = true;
    args.onResolved();
    settle();
  };

  return (async () => {
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    const { resolve, promise } = Promise.withResolvers<void>();

    try {
      await convex.mutation(api.permissionRequests.create, {
        workspaceId,
        runAttemptId,
        toolName,
        toolInput: inputStr,
        requestId: reqId,
      });
      console.log(`[lifecycle] workspace=${workspaceId} permission request: tool=${toolName} reqId=${reqId}`);
    } catch (err) {
      console.error(`[lifecycle] failed to create permission request:`, err);
      resolveOnce(resolve);
      return promise;
    }

    // Bail early if process already exited (avoid leaking a poller)
    if (args.isExited()) {
      resolveOnce(resolve);
      return promise;
    }

    const writeStdin = await args.stdinReady;

    // Process may have exited while we awaited stdinReady
    if (args.isExited()) {
      resolveOnce(resolve);
      return promise;
    }

    // Use setTimeout chaining instead of setInterval to prevent overlapping
    // async callbacks when the Convex query takes longer than the poll interval.
    // Backoff from 1s to 5s to reduce query load for long-pending requests.
    let pollInterval = 1000;
    const MAX_POLL_INTERVAL = 5000;
    const pollOnce = async () => {
      try {
        if (args.isExited()) {
          resolveOnce(resolve);
          return;
        }

        const record = await convex.query(api.permissionRequests.getByRequestId, {
          runAttemptId,
          requestId: reqId,
        });

        if (!record || record.status === "pending") {
          // Not resolved yet — back off and schedule next poll
          pollInterval = Math.min(pollInterval + 500, MAX_POLL_INTERVAL);
          if (!args.isExited()) schedulePoll();
          else resolveOnce(resolve);
          return;
        }

        const approved = record.status === "approved" || record.status === "always_allowed";
        writeStdin(args.formatPermissionResponse(reqId, approved));

        // If "always_allowed", persist the tool name to the agent config's
        // allowedToolPatterns so it is auto-approved on future runs.
        if (record.status === "always_allowed" && args.agentConfigId) {
          try {
            await convex.mutation(api.agentConfigs.addAllowedTool, {
              id: args.agentConfigId,
              toolPattern: toolName,
            });
            console.log(`[lifecycle] workspace=${workspaceId} persisted always-allow for tool=${toolName}`);
          } catch { /* non-critical */ }
        }

        resolveOnce(resolve);
      } catch {
        // Polling error — schedule retry unless exited
        if (!args.isExited()) schedulePoll();
        else resolveOnce(resolve);
      }
    };
    const schedulePoll = () => {
      const timer = setTimeout(() => {
        args.activePollerTimers.delete(timer);
        void pollOnce();
      }, pollInterval);
      args.activePollerTimers.add(timer);
    };
    schedulePoll();

    return promise;
  })();
}

export async function runAgent(
  convex: ConvexClient,
  config: WorkerConfig,
  executor: AgentExecutor,
  workspaceId: Id<"workspaces">,
  agentConfig: Doc<"agentConfigs">,
  cwd: string,
  prompt: string,
  type: string,
  abortSignal: AbortSignal,
  options?: {
    mcpConfigPath?: string;
    mcpServer?: McpServer | null;
    sessionId?: string;
    // "accept" mode is only used for coding runs; plan/review runs always use "plan" mode.
    permissionMode?: "plan" | "dangerously-skip-permissions" | "accept";
    allowedTools?: string[];
    settingsPath?: string;
    disableSlashCommands?: boolean;
    agentConfigId?: Id<"agentConfigs">;
  },
): Promise<{
  success: boolean;
  lastOutput?: string;
  exitCode?: number;
  sessionId?: string;
  events: AgentEvent[];
}> {
  console.log(`[lifecycle] workspace=${workspaceId} starting ${type} agent=${agentConfig.name} cwd=${cwd}`);
  // Truncate prompt for storage — Convex has a 1 MiB document size limit
  const MAX_STORED_PROMPT = 50_000;
  const storedPrompt = prompt.length > MAX_STORED_PROMPT
    ? prompt.slice(0, MAX_STORED_PROMPT) + "\n\n... [truncated]"
    : prompt;
  const adapter = getAdapter(agentConfig.agentType);
  const runAttemptId = await convex.mutation(api.runAttempts.create, {
    workspaceId,
    agentConfigId: agentConfig._id,
    type,
    prompt: storedPrompt,
  });

  // Update MCP server with current runAttemptId so tool calls are logged
  if (options?.mcpServer) {
    options.mcpServer.setRunAttemptId(runAttemptId);
  }
  const cmd = adapter.buildCommand({
    config: agentConfig,
    prompt,
    cwd,
    mcpConfigPath: options?.mcpConfigPath,
    sessionId: options?.sessionId,
    permissionMode: options?.permissionMode,
    allowedTools: options?.allowedTools,
    settingsPath: options?.settingsPath,
    disableSlashCommands: options?.disableSlashCommands,
  });

  // Prevent git from opening an editor during rebase/merge in agent subprocesses
  cmd.env["GIT_EDITOR"] = "true";
  cmd.env["GIT_MERGE_AUTOEDIT"] = "no";

  console.log(`[lifecycle] workspace=${workspaceId} executing: ${cmd.command} ${cmd.args.join(" ")}`);

  const logBuffer: LogEntry[] = [];
  const structuredEvents: AgentEvent[] = [];
  let lastOutput = "";
  const lastStderrLines: string[] = [];
  const MAX_STDERR_LINES = 10;
  const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

  // Stdin is needed for accept mode (Claude Code permission protocol) or adapters that
  // communicate via stdin. Permission handling is a separate concern:
  // it's enabled for accept mode OR adapters that declare their own permission protocol.
  const isAcceptMode = options?.permissionMode === "accept";
  const needsStdin = isAcceptMode || !!adapter.needsStdin;
  const handlesPermissions = isAcceptMode || !!adapter.handlesPermissions;
  let resolveStdinReady: ((write: (data: string) => void) => void) | undefined;
  let processExited = false;
  const stdinReady = needsStdin
    ? new Promise<(data: string) => void>((resolve) => { resolveStdinReady = resolve; })
    : undefined;
  const stallPauseSignal: StallPauseSignal = { paused: false };
  let pendingPermissionCount = 0;
  const activePollerTimers = new Set<ReturnType<typeof setTimeout>>();

  const flushLogs = async () => {
    if (logBuffer.length > 0) {
      const entries = logBuffer.splice(0, logBuffer.length);
      try {
        await convex.mutation(api.agentLogs.appendBatch, { entries });
      } catch { /* empty */ }
    }
  };

  const result = await executor.execute({
    command: cmd.command,
    args: cmd.args,
    env: cmd.env,
    cwd,
    timeoutMs: agentConfig.timeoutMs,
    stallTimeoutMs: config.stallTimeoutMs,
    onStdinReady: needsStdin ? (write) => {
      resolveStdinReady?.(write);
      // Send initial stdin message if the adapter requires it
      const initialMsg = adapter.getInitialStdinMessage?.(prompt);
      if (initialMsg) write(initialMsg);
    } : undefined,
    stallPauseSignal: handlesPermissions ? stallPauseSignal : undefined,
    onLine: (stream, line) => {
      lastOutput = line;
      if (stream === "stderr") {
        console.log(`[executor:stderr] workspace=${workspaceId} ${line}`);
        lastStderrLines.push(line);
        if (lastStderrLines.length > MAX_STDERR_LINES) lastStderrLines.shift();
      }
      const events = adapter.parseLine(line);
      for (const event of events) {
        if (event.type === "system") {
          const data = event.data as Record<string, unknown>;
          if (data["subtype"] === "init") {
            if (!data["permissionMode"] && options?.permissionMode) {
              data["permissionMode"] = options.permissionMode;
            }
            if (!data["model"] && agentConfig.model) {
              data["model"] = agentConfig.model;
            }
          }
        }
      }
      structuredEvents.push(...events);

      // Handle permission requests for accept mode or adapters with their own permission protocol
      if (handlesPermissions) {
        for (const event of events) {
          if (event.type === "permission_request") {
            const data = event.data as Record<string, unknown>;
            const tool = data["tool"] as Record<string, unknown> | undefined;
            const reqId = (data["request_id"] ?? data["id"] ?? "") as string;
            const toolName = (tool?.["name"] ?? data["name"] ?? "unknown") as string;
            const toolInput = tool?.["input"] ?? data["input"];
            // Truncate for DB storage; UI components apply their own shorter display limits.
            // Result is stored as a plain string field, so mid-JSON truncation is fine for display.
            const inputStr = toolInput ? truncateToolInput(toolInput, 2000) : undefined;

            pendingPermissionCount++;
            stallPauseSignal.paused = true;

            void handlePermissionRequest({
              convex, workspaceId, runAttemptId, reqId, toolName, inputStr,
              stdinReady: stdinReady ?? Promise.resolve(() => {}), activePollerTimers,
              agentConfigId: options?.agentConfigId,
              formatPermissionResponse: (id, approved) => adapter.formatPermissionResponse(id, approved),
              onResolved: () => {
                pendingPermissionCount--;
                if (pendingPermissionCount <= 0) {
                  pendingPermissionCount = 0;
                  stallPauseSignal.paused = false;
                }
              },
              isExited: () => processExited,
            });
          }
        }
      }

      if (events.length <= 1) {
        // Single or no event — store inline as before
        logBuffer.push({
          runAttemptId,
          workspaceId,
          stream,
          line,
          structured: clampDepth(events[0] ?? null, 8) as AgentEvent | null,
          timestamp: Date.now(),
        });
      } else {
        // Multiple events from one line (e.g., text + tool_use in one assistant message)
        // Store the raw line with the first event, then add extra entries for remaining events
        const ts = Date.now();
        logBuffer.push({
          runAttemptId,
          workspaceId,
          stream,
          line,
          structured: clampDepth(events[0] ?? null, 8) as AgentEvent | null,
          timestamp: ts,
        });
        for (let i = 1; i < events.length; i++) {
          logBuffer.push({
            runAttemptId,
            workspaceId,
            stream,
            line: "",
            structured: clampDepth(events[i] ?? null, 8) as AgentEvent | null,
            timestamp: ts + i, // offset to preserve ordering
          });
        }
      }
      timerRef.current ??= setTimeout(() => {
        timerRef.current = null;
        void flushLogs();
      }, 100);
    },
    signal: abortSignal,
  });

  if (timerRef.current !== null) clearTimeout(timerRef.current);
  // Clean up permission state: resolve stdinReady with a no-op to unblock any waiting IIFEs,
  // clear all pollers, reset stall pause, and expire stale pending requests.
  processExited = true;
  stallPauseSignal.paused = false;
  resolveStdinReady?.(() => {}); // unblock any awaiting handlePermissionRequest
  for (const timer of activePollerTimers) clearTimeout(timer);
  activePollerTimers.clear();
  if (isAcceptMode) {
    try {
      await convex.mutation(api.permissionRequests.expirePending, { runAttemptId });
    } catch { /* non-critical cleanup */ }
  }
  // Clean up temporary CODEX_HOME if the adapter supports it
  adapter.cleanupCodexHome?.(cmd.env);
  try {
    rmSync(join("/tmp", `yes-kanban-hooks-${String(workspaceId)}`), { recursive: true, force: true });
  } catch { /* non-critical */ }
  await flushLogs();

  const status = result.exitCode === 0 ? "succeeded"
    : result.timedOut ? "timed_out" : "failed";

  // Extract token usage and session ID from structured events
  const tokenUsage = adapter.extractTokenUsage(structuredEvents) ?? undefined;
  const sessionId = adapter.extractSessionId?.(structuredEvents) ?? undefined;

  console.log(`[lifecycle] workspace=${workspaceId} ${type} finished: status=${status} exit=${result.exitCode} timedOut=${result.timedOut} stalled=${result.stalled} tokens=${tokenUsage ? `${tokenUsage.totalTokens}` : "n/a"}`);

  await convex.mutation(api.runAttempts.complete, {
    id: runAttemptId,
    status,
    exitCode: result.exitCode,
    error: result.timedOut ? "Agent timed out"
      : result.stalled ? "Agent stalled"
      : result.exitCode !== 0 ? (
        lastStderrLines.length > 0
          ? `Exited with code ${result.exitCode}: ${lastStderrLines.join("\n")}`
          : `Exited with code ${result.exitCode}`
      )
      : undefined,
    tokenUsage,
    sessionId,
  });

  return { success: result.exitCode === 0, lastOutput, exitCode: result.exitCode, sessionId, events: structuredEvents };
}

/**
 * Extract the review verdict from structured assistant messages.
 * Scans all assistant_message events and returns the highest-severity verdict found
 * across all messages (REQUEST_CHANGES > CONCERN > APPROVE).
 */
export function extractReviewVerdict(events: AgentEvent[]): "APPROVE" | "REQUEST_CHANGES" | "CONCERN" | "UNKNOWN" {
  const VERDICTS = ["REQUEST_CHANGES", "CONCERN", "APPROVE"] as const;

  // First pass: look for explicit FINAL_VERDICT: line (preferred structured format)
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = extractTextFromEvent(event);
    for (const line of text.split("\n").reverse()) {
      const trimmed = line.trim();
      if (trimmed.startsWith("FINAL_VERDICT:")) {
        const rest = trimmed.slice("FINAL_VERDICT:".length).trim();
        for (const v of VERDICTS) {
          if (rest.startsWith(v)) return v;
        }
      }
    }
  }

  // Fallback: scan first lines of assistant messages for bare verdict keywords
  // Priority: REQUEST_CHANGES > APPROVE > CONCERN (CONCERN is non-blocking)
  const PRIORITY = { REQUEST_CHANGES: 3, APPROVE: 2, CONCERN: 1 } as const;
  let best: "APPROVE" | "REQUEST_CHANGES" | "CONCERN" | "UNKNOWN" = "UNKNOWN";
  let bestPriority = 0;
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = extractTextFromEvent(event);
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    for (const verdict of VERDICTS) {
      const pri = PRIORITY[verdict];
      if (firstLine.includes(verdict) && pri > bestPriority) {
        best = verdict;
        bestPriority = pri;
      }
    }
    if (bestPriority === 3) return best;
  }
  return best;
}

/**
 * Extract the plan review verdict from structured assistant messages.
 * Only checks the first line of each message to avoid false matches from
 * explanation text. Returns the highest-severity verdict found across all
 * messages (RESTART > REQUEST_CHANGES > APPROVE).
 */
export function extractPlanReviewVerdict(events: AgentEvent[]): "APPROVE" | "REQUEST_CHANGES" | "RESTART" | "UNKNOWN" {
  const VERDICTS = ["RESTART", "REQUEST_CHANGES", "APPROVE"] as const;

  // First pass: look for explicit FINAL_VERDICT: line
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = extractTextFromEvent(event);
    for (const line of text.split("\n").reverse()) {
      const trimmed = line.trim();
      if (trimmed.startsWith("FINAL_VERDICT:")) {
        const rest = trimmed.slice("FINAL_VERDICT:".length).trim();
        for (const v of VERDICTS) {
          if (rest.startsWith(v)) return v;
        }
      }
    }
  }

  // Fallback: scan first lines for bare verdict keywords
  const SEVERITY = { APPROVE: 1, REQUEST_CHANGES: 2, RESTART: 3 } as const;
  let best: "APPROVE" | "REQUEST_CHANGES" | "RESTART" | "UNKNOWN" = "UNKNOWN";
  let bestSeverity = 0;
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = extractTextFromEvent(event);
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    for (const verdict of VERDICTS) {
      const sev = SEVERITY[verdict];
      if (firstLine.includes(verdict) && sev > bestSeverity) {
        best = verdict;
        bestSeverity = sev;
      }
    }
    if (bestSeverity === 3) return best;
  }
  return best;
}

/**
 * Extract all assistant text from events for building review feedback.
 */
export function extractAssistantText(events: AgentEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = extractTextFromEvent(event);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

function extractTextFromEvent(event: AgentEvent): string {
  const data = event.data as Record<string, unknown> | null;
  if (!data) return "";

  // stream-json assistant messages have content as string or array of content blocks
  const content = data["content"];
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");
  }

  // Handle Claude Code adapter format: data.message.content
  const message = data["message"] as Record<string, unknown> | string | undefined;
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    const msgContent = (message)["content"];
    if (typeof msgContent === "string") return msgContent;
    if (Array.isArray(msgContent)) {
      return msgContent
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n");
    }
  }

  return "";
}

export async function runTests(
  convex: ConvexClient,
  workspaceId: Id<"workspaces">,
  repos: Doc<"repos">[],
  worktrees: WorktreeEntry[],
  abortSignal?: AbortSignal,
): Promise<{ passed: boolean; output: string } | null> {
  for (const repo of repos) {
    if (!repo.testCommand) continue;
    const wt = worktrees.find((w) => w.repoId === repo._id);
    if (!wt) continue;

    if (abortSignal?.aborted) return null;

    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "testing",
    });

    let storedPrompt = repo.testCommand;
    if (storedPrompt.length > MAX_SCRIPT_PROMPT_LEN) {
      storedPrompt = storedPrompt.slice(0, MAX_SCRIPT_PROMPT_LEN) + "\n\n... [truncated]";
    }
    const runAttemptId = await convex.mutation(api.runAttempts.create, {
      workspaceId,
      type: "test",
      prompt: storedPrompt,
    });
    const { logger, flush } = createScriptLogFlusher(convex, runAttemptId, workspaceId);

    const proc = Bun.spawn(["sh", "-c", repo.testCommand], {
      cwd: wt.worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const onAbort = () => {
      try { process.kill(-proc.pid, "SIGTERM"); } catch { /* empty */ }
      try { proc.kill("SIGTERM"); } catch { /* empty */ }
      setTimeout(() => {
        try { process.kill(-proc.pid, "SIGKILL"); } catch { /* empty */ }
        try { proc.kill("SIGKILL"); } catch { /* empty */ }
      }, 2000);
    };
    abortSignal?.addEventListener("abort", onAbort);

    const timeoutTimer = repo.testTimeoutMs
      ? setTimeout(() => {
          try { proc.kill("SIGTERM"); } catch { /* empty */ }
        }, repo.testTimeoutMs)
      : null;

    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    await Promise.all([
      consumeStreamLines(proc.stdout, "stdout", {
        outParts: stdoutParts,
        onLine: (stream, line) => logger.onLine(stream, line),
      }),
      consumeStreamLines(proc.stderr, "stderr", {
        outParts: stderrParts,
        onLine: (stream, line) => logger.onLine(stream, line),
      }),
    ]);
    const exitCode = await proc.exited;

    if (timeoutTimer) clearTimeout(timeoutTimer);
    abortSignal?.removeEventListener("abort", onAbort);

    await flush();

    const output = stdoutParts.join("") + stderrParts.join("");

    if (abortSignal?.aborted) {
      await convex.mutation(api.runAttempts.complete, {
        id: runAttemptId,
        status: "cancelled",
        error: "Test run cancelled",
      });
      return null;
    }

    const success = exitCode === 0;
    await convex.mutation(api.runAttempts.complete, {
      id: runAttemptId,
      status: success ? "succeeded" : "failed",
      exitCode,
      error: success ? undefined : `Exited with code ${exitCode}`,
    });

    if (!success) {
      return { passed: false, output };
    }
  }
  return { passed: true, output: "" };
}

type RunTestsWithFixResult =
  | { ok: true; lastCodingSessionId: string | undefined }
  | { ok: false; kind: "tests_failed" }
  | { ok: false; kind: "agent_failed" };

/**
 * Run tests; on failure resume the coding agent once with test output, then re-run tests.
 */
async function runTestsWithFix(
  convex: ConvexClient,
  config: WorkerConfig,
  executor: AgentExecutor,
  workspaceId: Id<"workspaces">,
  agentConfig: Doc<"agentConfigs">,
  agentCwd: string,
  repos: Doc<"repos">[],
  worktrees: WorktreeEntry[],
  abortSignal: AbortSignal,
  lastCodingSessionId: string | undefined,
  mcpConfigPath: string | undefined,
  mcpServer: McpServer | null,
  settingsPath: string,
  disableSlashCommands: boolean,
  issueRef: string,
  issue: Doc<"issues"> | undefined,
): Promise<RunTestsWithFixResult | null> {
  const testResult = await runTests(convex, workspaceId, repos, worktrees, abortSignal);
  if (abortSignal.aborted) return null;
  if (testResult === null) return null;
  if (testResult.passed) {
    return { ok: true, lastCodingSessionId };
  }

  let testOutputForPrompt = testResult.output;
  if (testOutputForPrompt.length > MAX_SCRIPT_PROMPT_LEN) {
    testOutputForPrompt = testOutputForPrompt.slice(0, MAX_SCRIPT_PROMPT_LEN) + "\n\n... [truncated]";
  }
  const fixPrompt = buildTestFixPrompt(testOutputForPrompt);

  for (const wt of worktrees) {
    if (commitUnstagedChanges(wt.worktreePath, issueRef)) {
      console.log(`[lifecycle] workspace=${workspaceId} auto-committed before test-fix cycle`);
    }
  }

  if (!(await waitForPhaseCapacity(convex, workspaceId, "coding", abortSignal))) return null;
  await convex.mutation(api.workspaces.updateStatus, {
    id: workspaceId,
    status: "coding",
  });

  const fixResult = await runAgent(
    convex,
    config,
    executor,
    workspaceId,
    agentConfig,
    agentCwd,
    fixPrompt,
    "coding",
    abortSignal,
    {
      mcpConfigPath,
      mcpServer,
      sessionId: lastCodingSessionId,
      settingsPath,
      disableSlashCommands,
      allowedTools: CODING_TOOLS,
      permissionMode: agentConfig.permissionMode === "accept" ? "accept" : undefined,
      agentConfigId: agentConfig._id,
    },
  );

  const newSessionId = fixResult.sessionId;

  if (!fixResult.success) {
    await handleFailure(convex, config, workspaceId, agentConfig, fixResult, worktrees, issue);
    return { ok: false, kind: "agent_failed" };
  }

  for (const wt of worktrees) {
    if (commitUnstagedChanges(wt.worktreePath, issueRef)) {
      console.log(`[lifecycle] workspace=${workspaceId} auto-committed after test-fix cycle`);
    }
  }

  if (!(await waitForPhaseCapacity(convex, workspaceId, "testing", abortSignal))) return null;
  const retestResult = await runTests(convex, workspaceId, repos, worktrees, abortSignal);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mirror first `runTests` exit pattern; TS narrows abort after successful `runAgent`
  if (abortSignal.aborted) return null;
  if (retestResult === null) return null;
  if (!retestResult.passed) {
    return { ok: false, kind: "tests_failed" };
  }
  return { ok: true, lastCodingSessionId: newSessionId };
}

export async function handleFailure(
  convex: ConvexClient,
  _config: WorkerConfig,
  workspaceId: Id<"workspaces">,
  agentConfig: Doc<"agentConfigs">,
  result: { exitCode?: number },
  _worktrees: WorktreeEntry[],
  issue: Doc<"issues"> | undefined,
) {
  // Count existing run attempts to determine current attempt number
  const attempts = await convex.query(api.runAttempts.list, {
    workspaceId,
  });
  const attemptNumber: number = attempts.length;

  const terminalStatuses = [...TERMINAL_STATUSES];

  const canRetry = shouldRetry({
    attemptNumber,
    agentConfig,
    issueStatus: issue?.status,
    terminalStatuses,
  });

  if (canRetry) {
    const delay = computeBackoffDelay(
      agentConfig,
      attemptNumber,
      "failure",
    );
    const dueAt = Date.now() + delay;
    const error = result.exitCode !== undefined
      ? `Agent exited with code ${result.exitCode}`
      : "Agent failed";

    // Use the more detailed error from the latest run attempt (includes stderr) if available
    const lastAttempt = attempts[attempts.length - 1];
    const detailedError = lastAttempt?.error ?? error;

    await convex.mutation(api.retries.schedule, {
      workspaceId,
      attemptNumber: attemptNumber + 1,
      dueAt,
      error,
    });

    console.log(
      `[lifecycle] workspace=${workspaceId} failed, scheduling retry #${attemptNumber + 1} in ${delay}ms`,
    );
    // Keep workspace in failed state but don't set completedAt — it will be re-dispatched
    // Store the detailed error so the next attempt's prompt includes failure context
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "failed",
      lastError: detailedError,
    });
  } else {
    await convex.mutation(api.workspaces.updateStatus, {
      id: workspaceId,
      status: "failed",
      completedAt: Date.now(),
    });
    console.log(`[lifecycle] workspace=${workspaceId} failed, no retries remaining (attempt=${attemptNumber}, maxRetries=${agentConfig.maxRetries})`);
  }
}

/**
 * Attempt to resolve rebase conflicts using Claude Code.
 * Returns true if conflicts were resolved and rebase completed.
 */
export async function resolveRebaseConflicts(
  convex: ConvexClient,
  config: WorkerConfig,
  executor: AgentExecutor,
  workspaceId: Id<"workspaces">,
  agentConfig: Doc<"agentConfigs">,
  wt: WorktreeEntry,
  abortSignal: AbortSignal,
  template?: string,
): Promise<boolean> {
  const env = cleanGitEnv();

  // Get conflicted files — ls-files --unmerged is more reliable than diff --diff-filter=U during rebase
  const diffResult = Bun.spawnSync(
    ["git", "-C", wt.worktreePath, "ls-files", "--unmerged"],
    { timeout: 10000, env },
  );
  // ls-files --unmerged outputs "mode hash stage\tpath" — extract unique file paths
  const conflictedFiles = [
    ...new Set(
      diffResult.stdout.toString().trim().split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t")[1])
        .filter((f): f is string => !!f),
    ),
  ];

  if (conflictedFiles.length === 0) {
    console.log(`[lifecycle] workspace=${workspaceId} no conflicted files found`);
    return false;
  }

  console.log(`[lifecycle] workspace=${workspaceId} ${conflictedFiles.length} conflicted file(s), spawning agent`);

  const prompt = buildRebaseConflictPrompt(wt.baseBranch, conflictedFiles, template);

  // Override max-turns to 30 for bounded conflict resolution (only for adapters that support it)
  const supportsMaxTurns = agentConfig.agentType === "claude-code" || agentConfig.agentType === "codex";
  const filteredArgs = supportsMaxTurns
    ? [...agentConfig.args.filter((_a: string, i: number, arr: string[]) =>
        arr[i - 1] !== "--max-turns" && _a !== "--max-turns"
      ), "--max-turns", "30"]
    : [...agentConfig.args];
  const conflictConfig = { ...agentConfig, args: filteredArgs };

  const result = await runAgent(
    convex, config, executor, workspaceId, conflictConfig, wt.worktreePath,
    prompt, "rebase_conflict_resolution", abortSignal,
    { allowedTools: CODING_TOOLS },
  );

  if (!result.success) {
    console.log(`[lifecycle] workspace=${workspaceId} conflict resolution agent failed`);
    return false;
  }

  // Verify rebase completed — check git status for "rebase in progress"
  const statusResult = Bun.spawnSync(
    ["git", "-C", wt.worktreePath, "status", "--porcelain=v2", "--branch"],
    { timeout: 5000, env },
  );
  const statusOutput = statusResult.stdout.toString();
  const rebaseInProgress = statusOutput.includes("rebas") ||
    statusResult.exitCode !== 0;

  if (rebaseInProgress) {
    console.log(`[lifecycle] workspace=${workspaceId} rebase still in progress after agent`);
    return false;
  }

  console.log(`[lifecycle] workspace=${workspaceId} rebase conflicts resolved`);
  return true;
}

/**
 * Attempt a fast (git-only) rebase for all worktrees.
 * Returns "success" if rebase completed cleanly, "needs_agent" if conflicts
 * require agent-based resolution (rebase is aborted and stash restored).
 */
export function tryFastRebase(
  worktrees: WorktreeEntry[],
): "success" | "needs_agent" {
  const env = cleanGitEnv();

  for (const wt of worktrees) {
    const localBaseRev = Bun.spawnSync(
      ["git", "-C", wt.repoPath, "rev-parse", wt.baseBranch],
      { timeout: 5000, env },
    );
    if (localBaseRev.exitCode !== 0) {
      return "needs_agent";
    }
    const rebaseTarget = localBaseRev.stdout.toString().trim();

    // Stash uncommitted changes
    const stashResult = Bun.spawnSync(
      ["git", "-C", wt.worktreePath, "stash", "push", "-u", "-m", "yes-kanban-rebase-stash"],
      { timeout: 30000, env },
    );
    const didStash = stashResult.exitCode === 0 &&
      !stashResult.stdout.toString().includes("No local changes");

    const rebaseResult = Bun.spawnSync(
      ["git", "-C", wt.worktreePath, "rebase", rebaseTarget],
      { timeout: 60000, env },
    );

    if (rebaseResult.exitCode !== 0) {
      // Abort the rebase and restore stash — caller will use agent-based resolution
      Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "rebase", "--abort"],
        { timeout: 10000, env },
      );
      if (didStash) {
        Bun.spawnSync(
          ["git", "-C", wt.worktreePath, "stash", "pop"],
          { timeout: 10000, env },
        );
      }
      return "needs_agent";
    }

    // Restore stashed changes
    if (didStash) {
      const popResult = Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "stash", "pop"],
        { timeout: 10000, env },
      );
      if (popResult.exitCode !== 0) {
        // Stash pop conflict — needs agent
        return "needs_agent";
      }
    }
  }

  return "success";
}

/**
 * Execute a rebase for all worktrees, using Claude to resolve conflicts if needed.
 * Returns "success" if rebase completed, "conflict" if unresolvable.
 */
export async function executeRebase(
  convex: ConvexClient,
  config: WorkerConfig,
  executor: AgentExecutor,
  workspaceId: Id<"workspaces">,
  agentConfig: Doc<"agentConfigs">,
  worktrees: WorktreeEntry[],
  abortSignal: AbortSignal,
  rebaseTemplate?: string,
): Promise<"success" | "conflict"> {
  const env = cleanGitEnv();

  for (const wt of worktrees) {
    // Resolve the local base branch — this is what performLocalMerge merges into
    const localBaseRev = Bun.spawnSync(
      ["git", "-C", wt.repoPath, "rev-parse", wt.baseBranch],
      { timeout: 5000, env },
    );
    if (localBaseRev.exitCode !== 0) {
      console.error(`[lifecycle] workspace=${workspaceId} cannot resolve base branch ${wt.baseBranch}`);
      return "conflict";
    }
    const rebaseTarget = localBaseRev.stdout.toString().trim();

    // Stash uncommitted changes before rebasing — git refuses to rebase with a dirty index
    const stashResult = Bun.spawnSync(
      ["git", "-C", wt.worktreePath, "stash", "push", "-u", "-m", "yes-kanban-rebase-stash"],
      { timeout: 30000, env },
    );
    const didStash = stashResult.exitCode === 0 &&
      !stashResult.stdout.toString().includes("No local changes");

    if (didStash) {
      console.log(`[lifecycle] workspace=${workspaceId} stashed uncommitted changes before rebase`);
    }

    console.log(`[lifecycle] workspace=${workspaceId} rebasing ${wt.branchName} onto ${rebaseTarget}`);
    const rebaseResult = Bun.spawnSync(
      ["git", "-C", wt.worktreePath, "rebase", rebaseTarget],
      { timeout: 60000, env },
    );

    if (rebaseResult.exitCode !== 0) {
      const rebaseStderr = rebaseResult.stderr.toString().trim();
      console.log(`[lifecycle] workspace=${workspaceId} rebase failed (exit=${rebaseResult.exitCode}): ${rebaseStderr || "(no stderr)"}`);
      console.log(`[lifecycle] workspace=${workspaceId} attempting auto-resolution`);

      const resolved = await resolveRebaseConflicts(
        convex, config, executor, workspaceId, agentConfig, wt, abortSignal, rebaseTemplate,
      );

      if (!resolved) {
        // Abort the rebase
        Bun.spawnSync(
          ["git", "-C", wt.worktreePath, "rebase", "--abort"],
          { timeout: 10000, env },
        );
        // Pop stash back so changes aren't lost
        if (didStash) {
          Bun.spawnSync(
            ["git", "-C", wt.worktreePath, "stash", "pop"],
            { timeout: 10000, env },
          );
        }
        return "conflict";
      }
    }

    // Restore stashed changes after successful rebase
    if (didStash) {
      const popResult = Bun.spawnSync(
        ["git", "-C", wt.worktreePath, "stash", "pop"],
        { timeout: 10000, env },
      );
      if (popResult.exitCode !== 0) {
        console.log(`[lifecycle] workspace=${workspaceId} stash pop failed — changes may conflict with rebased code`);
      } else {
        console.log(`[lifecycle] workspace=${workspaceId} restored stashed changes after rebase`);
      }
    }
  }

  return "success";
}

/**
 * Squash-merges feature branches into their base branches, producing a single commit per branch.
 */
export function performLocalMerge(worktrees: WorktreeEntry[]): { success: boolean; error?: string } {
  for (const wt of worktrees) {
    const env = cleanGitEnv();
    const repo = wt.repoPath;

    // Clean up any broken merge/rebase state in the main repo before checkout
    Bun.spawnSync(["git", "-C", repo, "merge", "--abort"], { timeout: 5000, env });
    Bun.spawnSync(["git", "-C", repo, "rebase", "--abort"], { timeout: 5000, env });
    Bun.spawnSync(["git", "-C", repo, "reset", "--hard", "HEAD"], { timeout: 5000, env });

    // Checkout base branch in the main repo
    const checkout = Bun.spawnSync(
      ["git", "-C", repo, "checkout", wt.baseBranch],
      { timeout: 30000, env },
    );
    if (checkout.exitCode !== 0) {
      const err = checkout.stderr.toString().trim();
      return { success: false, error: `checkout ${wt.baseBranch} failed: ${err}` };
    }

    const squashMerge = Bun.spawnSync(
      ["git", "-C", repo, "merge", "--squash", wt.branchName],
      { timeout: 30000, env },
    );
    if (squashMerge.exitCode !== 0) {
      Bun.spawnSync(["git", "-C", repo, "reset", "--hard", "HEAD"], { timeout: 5000, env });
      const err =
        squashMerge.stderr.toString().trim() ||
        squashMerge.stdout.toString().trim() ||
        "(no output)";
      return { success: false, error: `squash merge failed: ${err}` };
    }

    const cachedQuiet = Bun.spawnSync(
      ["git", "-C", repo, "diff", "--cached", "--quiet"],
      { timeout: 10000, env },
    );
    // Exit 0 means no staged changes (empty branch, already applied, or idempotent retry).
    if (cachedQuiet.exitCode === 0) {
      continue;
    }

    const logRange = `${wt.baseBranch}..${wt.branchName}`;
    const logResult = Bun.spawnSync(
      ["git", "-C", repo, "log", logRange, "--reverse", "--pretty=format:%s"],
      { timeout: 10000, env },
    );
    if (logResult.exitCode !== 0) {
      Bun.spawnSync(["git", "-C", repo, "reset", "--hard", "HEAD"], { timeout: 5000, env });
      return { success: false, error: "failed to collect commit messages" };
    }
    const logOut = logResult.stdout.toString().trim();
    if (!logOut) {
      Bun.spawnSync(["git", "-C", repo, "reset", "--hard", "HEAD"], { timeout: 5000, env });
      return { success: false, error: "failed to collect commit messages" };
    }
    const subjects = logOut
      .split("\n")
      .filter((s) => s.length > 0)
      .filter((s) => !isAgentAttribution(s));
    if (subjects.length === 0) {
      Bun.spawnSync(["git", "-C", repo, "reset", "--hard", "HEAD"], { timeout: 5000, env });
      return { success: false, error: "failed to collect commit messages" };
    }

    const [firstSubject, ...otherSubjects] = subjects;
    if (firstSubject === undefined) {
      Bun.spawnSync(["git", "-C", repo, "reset", "--hard", "HEAD"], { timeout: 5000, env });
      return { success: false, error: "failed to collect commit messages" };
    }
    const message =
      otherSubjects.length === 0
        ? `${firstSubject}\n\n${YES_KANBAN_GIT_TRAILER}`
        : `${firstSubject}\n\n${otherSubjects.join("\n")}\n\n${YES_KANBAN_GIT_TRAILER}`;

    const commitResult = Bun.spawnSync(
      ["git", "-C", repo, "commit", "--no-verify", "-m", message],
      { timeout: 30000, env },
    );
    if (commitResult.exitCode !== 0) {
      Bun.spawnSync(["git", "-C", repo, "reset", "--hard", "HEAD"], { timeout: 5000, env });
      const err =
        commitResult.stderr.toString().trim() ||
        commitResult.stdout.toString().trim() ||
        "(no output)";
      return { success: false, error: `commit failed: ${err}` };
    }

    // Branch deletion is handled by removeWorktrees — can't delete here
    // because the worktree still references the branch.
  }

  return { success: true };
}

/**
 * Push the base branch to origin after a successful local merge.
 * Deduplicates by repoPath + baseBranch so multi-repo workspaces do not push twice.
 * Every distinct repo is attempted even if an earlier push fails; failures are aggregated.
 */
export function pushBaseBranch(worktrees: WorktreeEntry[]): { success: boolean; error?: string } {
  const seen = new Set<string>();
  const failures: string[] = [];
  for (const wt of worktrees) {
    const key = `${wt.repoPath}:${wt.baseBranch}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const env = cleanGitEnv();
    const result = Bun.spawnSync(
      ["git", "-C", wt.repoPath, "push", "origin", wt.baseBranch],
      { timeout: 60000, env },
    );
    if (result.exitCode !== 0) {
      const err = result.stderr.toString().trim() || "(no output)";
      failures.push(`push ${wt.baseBranch} failed for ${wt.repoPath}: ${err}`);
    }
  }
  if (failures.length > 0) {
    return { success: false, error: failures.join("; ") };
  }
  return { success: true };
}
