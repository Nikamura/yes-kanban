import type { Doc, Id } from "../../convex/_generated/dataModel";

export interface WorkerConfig {
  convexUrl: string;
  maxConcurrentAgents: number;
  stallTimeoutMs: number;
  defaultAgentTimeoutMs: number;
  worktreeRoot: string;
  pollIntervalMs: number;
}

export interface AgentEvent {
  type: "assistant_message" | "tool_use" | "tool_result" | "token_usage" | "error" | "completion" | "system" | "permission_request" | "unknown";
  data: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface IAgentAdapter {
  buildCommand(args: {
    config: Doc<"agentConfigs">;
    prompt: string;
    cwd: string;
    mcpConfigPath?: string;
    sessionId?: string;
    permissionMode?: "plan" | "dangerously-skip-permissions" | "accept";
    allowedTools?: string[];
    settingsPath?: string;
    disableSlashCommands?: boolean;
  }): { command: string; args: string[]; env: Record<string, string> };

  parseLine(line: string): AgentEvent[];

  extractTokenUsage(events: AgentEvent[]): TokenUsage | null;

  /** Extract session ID from completion events for --resume support. */
  extractSessionId?(events: AgentEvent[]): string | null;

  /** Whether the agent needs stdin piped even outside accept mode (e.g. for sending prompts). */
  needsStdin?: boolean;

  /** Whether the adapter handles permission requests via its own stdin protocol (independent of accept mode). */
  handlesPermissions?: boolean;

  /** Return the initial message to send via stdin after spawn (e.g. the prompt in JSONL format). */
  getInitialStdinMessage?(prompt: string): string | null;

  /** Format a permission response to send via stdin when a permission request is resolved. */
  formatPermissionResponse(requestId: string, approved: boolean): string;

  /** Clean up temporary resources (e.g. CODEX_HOME) created during buildCommand. */
  cleanupCodexHome?(env: Record<string, string>): void;
}

/** Shape of a worktree entry as stored in the workspace document. */
export interface WorktreeEntry {
  repoId: Id<"repos">;
  repoPath: string;
  baseBranch: string;
  branchName: string;
  worktreePath: string;
}

/** Shape of log entries buffered for batch append. */
export interface LogEntry {
  runAttemptId: Id<"runAttempts">;
  workspaceId: Id<"workspaces">;
  stream: string;
  line: string;
  structured: AgentEvent | null;
  timestamp: number;
}

/** Attachment metadata with resolved URL for prompt building. */
export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  /** Local filesystem path where the attachment was downloaded (if available). */
  localPath?: string;
}

/** The task returned by api.dispatch.next */
export interface DispatchTask {
  workspaceId: Id<"workspaces">;
  issueId?: Id<"issues">;
  projectId: Id<"projects">;
  agentConfig: Doc<"agentConfigs">;
  repos: Doc<"repos">[];
  issue?: Doc<"issues">;
  projectSlug?: string;
  additionalPrompt?: string;
}

export interface ExecuteResult {
  exitCode: number;
  timedOut: boolean;
  stalled: boolean;
}
