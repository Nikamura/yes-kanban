import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

/**
 * Maps OpenCode tool names to Claude-style tool names for shared renderers.
 */
function normalizeToolName(tool: string): string {
  const map: Record<string, string> = {
    bash: "Bash",
    read: "Read",
    write: "Write",
    edit: "Edit",
    grep: "Grep",
    glob: "Glob",
    webfetch: "WebFetch",
    websearch: "WebSearch",
    task: "Task",
  };
  const lower = tool.toLowerCase();
  return map[lower] ?? tool;
}

/**
 * Normalize OpenCode tool `state.input` to shapes ToolRenderers expect.
 */
function normalizeToolInput(tool: string, input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const lower = tool.toLowerCase();
  if (lower === "bash") {
    return {
      command: (input["command"] as string | undefined) ?? "",
      description: (input["description"] as string | undefined) ?? "",
    };
  }
  if (lower === "read" || lower === "write" || lower === "edit") {
    const path =
      (input["path"] as string | undefined) ??
      (input["file"] as string | undefined) ??
      (input["file_path"] as string | undefined) ??
      "unknown";
    if (lower === "read") return { file_path: path };
    return { ...input, file_path: path };
  }
  return input;
}

// eslint-disable-next-line no-control-regex -- intentional: stripping terminal escape sequences
const RE_OSC_ESC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const RE_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const RE_CHARSET = /\x1b[()][A-Z0-9]/g;
// eslint-disable-next-line no-control-regex
const RE_BARE_OSC = /\]0;[^\x07]*?(?:\x07|(?=\]0;|\{))/g;

/**
 * Strip ANSI escape sequences and OSC (Operating System Command) sequences
 * that OpenCode's terminal emits (e.g. `\x1b]0;title\x07` or `]0;title`).
 * These get prepended to JSON lines and prevent `JSON.parse` from succeeding.
 */
function stripTerminalEscapes(line: string): string {
  return line
    .replace(RE_OSC_ESC, "")
    .replace(RE_CSI, "")
    .replace(RE_CHARSET, "")
    .replace(RE_BARE_OSC, "")
    .trim();
}

/**
 * Adapter for OpenCode CLI (`opencode run --format json`).
 * JSONL event types: `step_start`, `text`, `tool_use`, `step_finish`, `error`.
 *
 * Permission modes: OpenCode does not expose distinct automation flags for plan vs
 * accept vs yolo — all runs use the same `opencode run` invocation.
 * MCP is configured via `opencode.json` in the worktree cwd (written by lifecycle).
 */
export class OpenCodeAdapter implements IAgentAdapter {
  buildCommand(args: {
    config: Doc<"agentConfigs">;
    prompt: string;
    cwd: string;
    mcpConfigPath?: string;
    sessionId?: string;
    permissionMode?: "plan" | "dangerously-skip-permissions" | "accept";
  }): { command: string; args: string[]; env: Record<string, string> } {
    void args.permissionMode;
    void args.mcpConfigPath;
    void args.cwd;

    const cmdArgs: string[] = ["run", "--format", "json"];

    if (args.sessionId) {
      cmdArgs.push("--session", args.sessionId);
    }

    if (args.config.model) {
      cmdArgs.push("--model", args.config.model);
    }

    if (args.config.args.length > 0) {
      cmdArgs.push(...args.config.args);
    }

    cmdArgs.push(args.prompt);

    return {
      command: args.config.command,
      args: cmdArgs,
      env: { ...process.env, ...(args.config.env ?? {}) } as Record<string, string>,
    };
  }

  parseLine(line: string): AgentEvent[] {
    const cleaned = stripTerminalEscapes(line);
    if (!cleaned) return [];
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const eventType = parsed["type"] as string | undefined;

      if (eventType === "step_start") {
        return [{ type: "system", data: parsed }];
      }

      if (eventType === "text") {
        const part = parsed["part"] as Record<string, unknown> | undefined;
        const text = (part?.["text"] as string | undefined) ?? "";
        const content = text ? [{ type: "text", text }] : [];
        return [{ type: "assistant_message", data: { ...parsed, message: { content } } }];
      }

      if (eventType === "tool_use") {
        return this.parseToolUse(parsed);
      }

      if (eventType === "step_finish") {
        const events: AgentEvent[] = [{ type: "completion", data: parsed }];
        const part = parsed["part"] as Record<string, unknown> | undefined;
        const tokens = part?.["tokens"] as Record<string, unknown> | undefined;
        if (tokens && typeof tokens === "object") {
          events.push({ type: "token_usage", data: { tokens } });
        }
        return events;
      }

      if (eventType === "error") {
        return [{ type: "error", data: parsed }];
      }

      return [{ type: "unknown", data: parsed }];
    } catch {
      return [];
    }
  }

  private parseToolUse(parsed: Record<string, unknown>): AgentEvent[] {
    const part = parsed["part"] as Record<string, unknown> | undefined;
    const state = part?.["state"] as Record<string, unknown> | undefined;
    const status = state?.["status"] as string | undefined;
    const tool = (part?.["tool"] as string | undefined) ?? "unknown";
    const callId = (part?.["callID"] as string | undefined) ?? (part?.["callId"] as string | undefined);
    const name = normalizeToolName(tool);
    const inputRaw = state?.["input"] as Record<string, unknown> | undefined;
    const input = normalizeToolInput(tool, inputRaw);
    const toolUseId = callId ?? (part?.["id"] as string | undefined);

    const toolUse: AgentEvent = {
      type: "tool_use",
      data: { name, input, tool_use_id: toolUseId },
    };

    if (status !== "completed") {
      return [toolUse];
    }

    const output =
      (state?.["output"] as string | undefined) ??
      ((state?.["metadata"] as Record<string, unknown> | undefined)?.["output"] as string | undefined) ??
      "";

    const toolResult: AgentEvent = {
      type: "tool_result",
      data: {
        name,
        input,
        content: typeof output === "string" ? output : JSON.stringify(output),
        tool_use_id: toolUseId,
      },
    };

    return [toolUse, toolResult];
  }

  extractTokenUsage(events: AgentEvent[]): TokenUsage | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.type !== "token_usage") continue;
      const data = event.data as Record<string, unknown>;
      const tokens = data["tokens"] as Record<string, unknown> | undefined;
      if (!tokens) continue;

      const input = Number(tokens["input"]) || 0;
      const output = Number(tokens["output"]) || 0;
      const reasoning = Number(tokens["reasoning"]) || 0;
      const cache = tokens["cache"] as Record<string, unknown> | undefined;
      const cacheRead = Number(cache?.["read"]) || 0;
      const cacheWrite = Number(cache?.["write"]) || 0;

      return {
        inputTokens: input,
        outputTokens: output + reasoning,
        totalTokens: input + output + reasoning,
        cacheCreationInputTokens: cacheWrite || undefined,
        cacheReadInputTokens: cacheRead || undefined,
      };
    }
    return null;
  }

  extractSessionId(events: AgentEvent[]): string | null {
    for (const event of events) {
      if (event.type !== "system") continue;
      const data = event.data as Record<string, unknown>;
      if (data["type"] !== "step_start") continue;
      const sid =
        (data["sessionID"] as string | undefined) ?? (data["session_id"] as string | undefined);
      if (sid) return sid;
    }
    return null;
  }

  formatPermissionResponse(_requestId: string, _approved: boolean): string {
    throw new Error("OpenCode run does not support interactive permission responses");
  }
}
