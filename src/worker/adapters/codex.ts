import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

const TOOL_ITEM_TYPES = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search"]);

/**
 * Convert a Claude-Code-style MCP JSON config into Codex TOML format.
 * Handles flat string keys, string arrays, and optional `enabled_tools`.
 */
function mcpJsonToToml(
  json: { mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> },
  allowedTools?: string[],
): string {
  // Group allowed tools by MCP server: mcp__<server>__<tool> → { server: [tool, ...] }
  const enabledByServer: Record<string, string[]> = {};
  if (allowedTools) {
    for (const tool of allowedTools) {
      const sepIdx = tool.indexOf("__");
      if (sepIdx === -1) continue;
      const rest = tool.slice(sepIdx + 2);
      const sepIdx2 = rest.indexOf("__");
      if (sepIdx2 === -1) continue;
      const prefix = tool.slice(0, sepIdx);
      if (prefix !== "mcp") continue;
      const server = rest.slice(0, sepIdx2);
      const toolName = rest.slice(sepIdx2 + 2);
      if (server && toolName) {
        (enabledByServer[server] ??= []).push(toolName);
      }
    }
  }

  const lines: string[] = [];
  for (const [name, server] of Object.entries(json.mcpServers)) {
    lines.push(`[mcp_servers.${name}]`);
    lines.push(`command = ${tomlString(server.command)}`);
    if (server.args && server.args.length > 0) {
      lines.push(`args = [${server.args.map(tomlString).join(", ")}]`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      const envPairs = Object.entries(server.env)
        .map(([key, value]) => `${key} = ${tomlString(value)}`)
        .join(", ");
      lines.push(`env = { ${envPairs} }`);
    }
    const enabled = enabledByServer[name];
    if (enabled && enabled.length > 0) {
      lines.push(`enabled_tools = [${enabled.map(tomlString).join(", ")}]`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function tomlString(value: string): string {
  // Use basic TOML string with escaping for backslashes and quotes
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Adapter for Codex CLI using `codex exec --json` for structured JSONL output.
 */
export class CodexAdapter implements IAgentAdapter {
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
  }): { command: string; args: string[]; env: Record<string, string> } {
    const mode = args.permissionMode ?? "dangerously-skip-permissions";
    const env: Record<string, string> = { ...process.env, ...(args.config.env ?? {}) } as Record<string, string>;

    // Session resume or fresh exec
    let cmdArgs: string[];
    if (args.sessionId) {
      // Resume a previous session. Note: resume+json needs empirical verification —
      // if Codex doesn't support --json with resume, this will fail gracefully.
      cmdArgs = ["resume", args.sessionId, "--json"];
    } else {
      cmdArgs = ["exec", "--json"];
    }

    // Isolation flags for automated runs
    // Skip --ephemeral when resuming — it would conflict with reading the persisted session
    if (!args.sessionId) {
      cmdArgs.push("--ephemeral");
    }
    cmdArgs.push("--skip-git-repo-check");

    // Permission mode
    if (mode === "dangerously-skip-permissions") {
      cmdArgs.push("--yolo");
    } else if (mode === "accept") {
      cmdArgs.push("--full-auto");
    } else {
      // "plan" — read-only sandbox with on-request approval
      cmdArgs.push("--sandbox", "read-only", "--ask-for-approval", "on-request");
    }

    // Skip loading project docs when settings isolation is active
    if (args.settingsPath || args.disableSlashCommands) {
      cmdArgs.push("--no-project-doc");
    }

    if (args.config.model) {
      cmdArgs.push("-m", args.config.model);
    }

    // MCP config: convert JSON to TOML and set CODEX_HOME
    if (args.mcpConfigPath) {
      try {
        const jsonContent = readFileSync(args.mcpConfigPath, "utf-8");
        const mcpConfig = JSON.parse(jsonContent);
        const toml = mcpJsonToToml(mcpConfig, args.allowedTools);

        // Use cwd-based hash for unique temp directory
        const codexHome = `/tmp/yes-kanban-codex-home-${hashPath(args.cwd)}`;
        mkdirSync(codexHome, { recursive: true });
        writeFileSync(`${codexHome}/config.toml`, toml);
        env["CODEX_HOME"] = codexHome;
      } catch (err) {
        console.error("[codex] Failed to convert MCP config to TOML:", err);
      }
    }

    if (args.config.args.length > 0) {
      cmdArgs.push(...args.config.args);
    }

    // Prompt is the positional argument (must be last)
    cmdArgs.push(args.prompt);

    return { command: args.config.command, args: cmdArgs, env };
  }

  parseLine(line: string): AgentEvent[] {
    try {
      const parsed = JSON.parse(line);
      const eventType = parsed.type as string | undefined;

      if (eventType === "thread.started" || eventType === "turn.started") {
        return [{ type: "system", data: parsed }];
      }

      if (eventType === "item.started") {
        return this.handleItemStarted(parsed);
      }

      if (eventType === "item.completed") {
        return this.handleItemCompleted(parsed);
      }

      if (eventType === "turn.completed") {
        const events: AgentEvent[] = [{ type: "completion", data: parsed }];
        if (parsed.usage) {
          events.push({ type: "token_usage", data: parsed });
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

  private handleItemStarted(parsed: Record<string, unknown>): AgentEvent[] {
    const item = parsed["item"] as Record<string, unknown> | undefined;
    const itemType = item?.["type"] as string | undefined;

    if (itemType && TOOL_ITEM_TYPES.has(itemType)) {
      return [{ type: "tool_use", data: parsed }];
    }
    if (itemType === "agent_message") {
      return [{ type: "assistant_message", data: parsed }];
    }
    if (itemType === "reasoning") {
      return [{ type: "system", data: parsed }];
    }
    return [{ type: "unknown", data: parsed }];
  }

  private handleItemCompleted(parsed: Record<string, unknown>): AgentEvent[] {
    const item = parsed["item"] as Record<string, unknown> | undefined;
    const itemType = item?.["type"] as string | undefined;

    if (itemType && TOOL_ITEM_TYPES.has(itemType)) {
      return [{ type: "tool_result", data: parsed }];
    }
    if (itemType === "agent_message") {
      return [{ type: "assistant_message", data: parsed }];
    }
    return [{ type: "unknown", data: parsed }];
  }

  extractTokenUsage(events: AgentEvent[]): TokenUsage | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.type !== "token_usage") continue;
      const data = event.data as Record<string, unknown>;
      const usage = data["usage"] as Record<string, unknown> | undefined;
      if (!usage) continue;

      const input = Number(usage["input_tokens"]) || 0;
      const output = Number(usage["output_tokens"]) || 0;
      const cacheRead = Number(usage["cached_input_tokens"]) || 0;

      return {
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        cacheReadInputTokens: cacheRead || undefined,
      };
    }
    return null;
  }

  formatPermissionResponse(_requestId: string, _approved: boolean): string {
    throw new Error("Codex exec mode does not support interactive permission responses");
  }

  extractSessionId(events: AgentEvent[]): string | null {
    for (const event of events) {
      if (event.type !== "system") continue;
      const data = event.data as Record<string, unknown>;
      if (data["type"] !== "thread.started") continue;
      const threadId = data["thread_id"] as string | undefined;
      if (threadId) return threadId;
    }
    return null;
  }
}

/** Simple hash for generating unique temp directory names from workspace paths. */
function hashPath(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
