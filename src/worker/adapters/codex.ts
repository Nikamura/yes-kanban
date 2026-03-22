import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
    lines.push(`[mcp_servers.${tomlKey(name)}]`);
    lines.push(`command = ${tomlString(server.command)}`);
    if (server.args && server.args.length > 0) {
      lines.push(`args = [${server.args.map(tomlString).join(", ")}]`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      const envPairs = Object.entries(server.env)
        .map(([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`)
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

/** TOML bare keys only allow A-Za-z0-9, `-`, and `_`. */
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

function tomlString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function tomlKey(key: string): string {
  return TOML_BARE_KEY.test(key) ? key : tomlString(key);
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

    // Always use exec — codex resume doesn't support --json or other flags
    // needed for automation. Session context is handled by the prompt instead.
    const cmdArgs = ["exec", "--json", "--ephemeral", "--skip-git-repo-check"];

    // Permission mode
    if (mode === "dangerously-skip-permissions") {
      cmdArgs.push("--yolo");
    } else if (mode === "accept") {
      cmdArgs.push("--full-auto");
    } else {
      // "plan" — read-only sandbox (exec mode doesn't support --ask-for-approval)
      cmdArgs.push("--sandbox", "read-only");
    }

    // Note: codex exec doesn't support --no-project-doc, so we skip it

    if (args.config.model) {
      cmdArgs.push("-m", args.config.model);
    }

    // MCP config: convert JSON to TOML and set CODEX_HOME
    if (args.mcpConfigPath) {
      const codexHome = this.prepareMcpConfig(args.mcpConfigPath, args.allowedTools);
      env["CODEX_HOME"] = codexHome;
    }

    if (args.config.args.length > 0) {
      cmdArgs.push(...args.config.args);
    }

    // Prompt is the positional argument (must be last)
    cmdArgs.push(args.prompt);

    return { command: args.config.command, args: cmdArgs, env };
  }

  /**
   * Read an MCP JSON config, convert it to Codex TOML format, and write it
   * to a temporary CODEX_HOME directory. Returns the path to use as CODEX_HOME.
   * Call `cleanupCodexHome` with the returned path after the process exits.
   */
  private prepareMcpConfig(mcpConfigPath: string, allowedTools?: string[]): string {
    try {
      const jsonContent = readFileSync(mcpConfigPath, "utf-8");
      const mcpConfig = JSON.parse(jsonContent);
      if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object" || Array.isArray(mcpConfig.mcpServers)) {
        throw new Error("Missing or invalid 'mcpServers' key in MCP config");
      }
      const toml = mcpJsonToToml(mcpConfig, allowedTools);

      const codexHome = `/tmp/yes-kanban-codex-home-${randomUUID()}`;
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(`${codexHome}/config.toml`, toml);

      // Copy auth credentials from the real codex home so the agent can authenticate
      const realHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
      const authPath = join(realHome, "auth.json");
      if (existsSync(authPath)) {
        copyFileSync(authPath, join(codexHome, "auth.json"));
      }

      return codexHome;
    } catch (err) {
      throw new Error(`[codex] Failed to convert MCP config to TOML: ${String(err)}`, { cause: err });
    }
  }

  /** Remove the temporary CODEX_HOME directory created by `prepareMcpConfig`. */
  cleanupCodexHome(env: Record<string, string>): void {
    const codexHome = env["CODEX_HOME"];
    if (codexHome?.startsWith("/tmp/yes-kanban-codex-home-")) {
      try { rmSync(codexHome, { recursive: true }); } catch { /* best-effort */ }
    }
  }

  parseLine(line: string): AgentEvent[] {
    try {
      const parsed = JSON.parse(line);
      const eventType = parsed.type as string | undefined;

      if (eventType === "thread.started") {
        // Normalize to init subtype so SystemLine shows model info
        return [{ type: "system", data: { ...parsed, subtype: "init", model: parsed.model } }];
      }

      if (eventType === "turn.started") {
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

  /**
   * Split Codex `agent_message` items into UI-shaped events.
   * Codex JSONL nests content under `item.content`; LogStream.extractContent expects
   * `data.message.content` (Claude Code shape). Also peel embedded `tool_use` blocks
   * into separate events like ClaudeCodeAdapter.splitAssistantMessage.
   */
  private splitCodexAgentMessage(parsed: Record<string, unknown>): AgentEvent[] {
    const item = parsed["item"] as Record<string, unknown> | undefined;
    const content = item?.["content"];

    // Codex uses item.text (string) for agent_message text, not item.content (array).
    // Normalize to content blocks for the UI's extractContent/extractTextFromEvent.
    if (!Array.isArray(content)) {
      const text = item?.["text"] as string | undefined;
      const contentBlocks = text ? [{ type: "text", text }] : [];
      return [{ type: "assistant_message", data: { ...parsed, message: { content: contentBlocks } } }];
    }

    const events: AgentEvent[] = [];
    const textBlocks = content.filter((b: { type?: string }) => b.type === "text" || b.type === "output_text");
    const toolBlocks = content.filter((b: { type?: string }) => b.type === "tool_use");

    if (textBlocks.length > 0) {
      // Normalize output_text blocks to text blocks for the UI
      const normalized = textBlocks.map((b: { type?: string; text?: string }) =>
        b.type === "output_text" ? { type: "text", text: b.text } : b,
      );
      events.push({
        type: "assistant_message",
        data: { ...parsed, message: { content: normalized } },
      });
    }

    for (const block of toolBlocks) {
      const b = block as { name?: string; input?: unknown; id?: string };
      events.push({
        type: "tool_use",
        data: { name: b.name, input: b.input, tool_use_id: b.id },
      });
    }

    if (events.length === 0) {
      events.push({ type: "assistant_message", data: { ...parsed, message: { content } } });
    }

    return events;
  }

  private handleItemStarted(parsed: Record<string, unknown>): AgentEvent[] {
    const item = parsed["item"] as Record<string, unknown> | undefined;
    const itemType = item?.["type"] as string | undefined;

    if (itemType && TOOL_ITEM_TYPES.has(itemType)) {
      return [{ type: "tool_use", data: this.normalizeToolData(item, itemType) }];
    }
    if (itemType === "agent_message") {
      return this.splitCodexAgentMessage(parsed);
    }
    if (itemType === "reasoning") {
      return [{ type: "system", data: parsed }];
    }
    return [{ type: "unknown", data: parsed }];
  }

  private handleItemCompleted(parsed: Record<string, unknown>): AgentEvent[] {
    const item = parsed["item"] as Record<string, unknown> | undefined;
    const itemType = item?.["type"] as string | undefined;

    if (item && itemType && TOOL_ITEM_TYPES.has(itemType)) {
      const toolData = this.normalizeToolData(item, itemType);
      // For completed items, add output content for ToolResultLine
      const output = (item["aggregated_output"] as string | undefined) ?? "";
      return [{ type: "tool_result", data: { ...toolData, content: output, tool_use_id: item["id"] } }];
    }
    if (itemType === "agent_message") {
      return this.splitCodexAgentMessage(parsed);
    }
    return [{ type: "unknown", data: parsed }];
  }

  /**
   * Normalize codex item data to the shape ToolRenderers expect: { name, input, tool_use_id }.
   */
  private normalizeToolData(item: Record<string, unknown> | undefined, itemType: string): Record<string, unknown> {
    if (!item) return { name: itemType };
    const id = item["id"] as string | undefined;

    if (itemType === "command_execution") {
      return { name: "Bash", input: { command: item["command"] ?? "", description: "" }, tool_use_id: id };
    }
    if (itemType === "file_change") {
      return { name: "Edit", input: { file_path: item["file_path"] ?? item["filename"] ?? "unknown" }, tool_use_id: id };
    }
    if (itemType === "mcp_tool_call") {
      const serverLabel = item["server_label"] as string | undefined;
      const toolName = item["name"] as string | undefined;
      const name = serverLabel && toolName ? `mcp__${serverLabel}__${toolName}` : (toolName ?? "MCP");
      return { name, input: item["arguments"] ?? item["input"], tool_use_id: id };
    }
    if (itemType === "web_search") {
      return { name: "WebSearch", input: { query: item["query"] ?? "" }, tool_use_id: id };
    }
    return { name: itemType, tool_use_id: id };
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
