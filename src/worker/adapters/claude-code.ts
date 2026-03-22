import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

const DEFAULT_MAX_TURNS = 200;

export class ClaudeCodeAdapter implements IAgentAdapter {
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
    const cmdArgs: string[] = [];

    // Permission mode
    if (mode === "dangerously-skip-permissions") {
      cmdArgs.push("--dangerously-skip-permissions");
    } else if (mode === "accept") {
      // Default interactive mode — no permission flags needed.
      // Claude Code will emit permission_request events on stdout
      // and expect responses on stdin.
    } else {
      cmdArgs.push("--permission-mode", mode);
    }

    // Explicitly allow specific tools (e.g. MCP tools in plan mode)
    if (args.allowedTools && args.allowedTools.length > 0) {
      for (const tool of args.allowedTools) {
        cmdArgs.push("--allowedTools", tool);
      }
    }

    // Session resumption — continue previous session instead of starting fresh
    if (args.sessionId) {
      cmdArgs.push("--resume", args.sessionId, "-p", args.prompt);
    } else {
      cmdArgs.push("-p", args.prompt);
    }

    cmdArgs.push("--output-format", "stream-json", "--verbose");

    if (args.config.model) {
      cmdArgs.push("--model", args.config.model);
    }

    if (args.mcpConfigPath) {
      cmdArgs.push("--mcp-config", args.mcpConfigPath);
      cmdArgs.push("--strict-mcp-config");
    }

    // Block built-in tools that conflict with our MCP equivalents.
    // AskUserQuestion blocks on stdin which the worker can't provide;
    // the agent should use the MCP ask_question tool instead.
    cmdArgs.push("--disallowedTools", "AskUserQuestion");

    // Isolation: block loading user/project/local settings
    cmdArgs.push("--setting-sources", "");

    // Skills isolation
    if (args.disableSlashCommands) {
      cmdArgs.push("--disable-slash-commands");
    }
    if (args.settingsPath) {
      cmdArgs.push("--settings", args.settingsPath);
    }

    // Default max-turns guard unless user explicitly set one in config args
    const hasMaxTurns = args.config.args.some((a) => a === "--max-turns");
    if (!hasMaxTurns) {
      cmdArgs.push("--max-turns", String(DEFAULT_MAX_TURNS));
    }

    if (args.config.args.length > 0) {
      cmdArgs.push(...args.config.args);
    }

    return {
      command: args.config.command,
      args: cmdArgs,
      env: { ...process.env, ...(args.config.env ?? {}) } as Record<string, string>,
    };
  }

  parseLine(line: string): AgentEvent[] {
    try {
      const parsed = JSON.parse(line);

      // Assistant messages may contain both text and tool_use content blocks.
      // Split them into separate events so the UI can render each one.
      if (parsed.type === "assistant") {
        return this.splitAssistantMessage(parsed);
      }

      // Tool results arrive as "user" messages with tool_result content blocks.
      if (parsed.type === "user") {
        return this.extractToolResults(parsed);
      }

      if (parsed.type === "tool_use") {
        return [{ type: "tool_use", data: parsed }];
      }
      if (parsed.type === "tool_result") {
        return [{ type: "tool_result", data: parsed }];
      }
      if (parsed.type === "result") {
        return [{ type: "completion", data: parsed }];
      }
      if (parsed.type === "error") {
        return [{ type: "error", data: parsed }];
      }
      if (parsed.type === "system") {
        return [{ type: "system", data: parsed }];
      }
      if (parsed.type === "permission_request") {
        return [{ type: "permission_request", data: parsed }];
      }
      if (parsed.type === "usage" || parsed.usage) {
        return [{ type: "token_usage", data: parsed }];
      }
      // Skip noisy events that don't need rendering
      if (parsed.type === "rate_limit_event" || parsed.type === "content_block_delta" || parsed.type === "content_block_start" || parsed.type === "content_block_stop") {
        return [];
      }
      return [{ type: "unknown", data: parsed }];
    } catch {
      return [];
    }
  }

  /**
   * Split an assistant message into separate events for text and tool_use blocks.
   * Claude Code stream-json wraps tool calls inside assistant messages:
   *   {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}}]}}
   */
  private splitAssistantMessage(parsed: Record<string, unknown>): AgentEvent[] {
    const message = parsed["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    if (!Array.isArray(content)) {
      return [{ type: "assistant_message", data: parsed }];
    }

    const events: AgentEvent[] = [];
    const textBlocks = content.filter((b: any) => b.type === "text");
    const toolBlocks = content.filter((b: any) => b.type === "tool_use");

    // Emit text content as an assistant message (if any)
    if (textBlocks.length > 0) {
      events.push({
        type: "assistant_message",
        data: { ...parsed, message: { ...message, content: textBlocks } },
      });
    }

    // Emit each tool_use block as a separate tool_use event
    for (const block of toolBlocks) {
      events.push({
        type: "tool_use",
        data: { name: block.name, input: block.input, tool_use_id: block.id },
      });
    }

    // If no text and no tool blocks, still emit as assistant_message
    if (events.length === 0) {
      events.push({ type: "assistant_message", data: parsed });
    }

    return events;
  }

  /**
   * Extract tool_result events from "user" messages.
   * Claude Code stream-json wraps tool results as:
   *   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
   */
  private extractToolResults(parsed: Record<string, unknown>): AgentEvent[] {
    const message = parsed["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    if (!Array.isArray(content)) return [];

    const events: AgentEvent[] = [];
    for (const block of content) {
      if (block.type === "tool_result") {
        events.push({ type: "tool_result", data: block });
      }
    }

    // Also check top-level tool_use_result field (contains richer data)
    const toolUseResult = parsed["tool_use_result"] as Record<string, unknown> | undefined;
    if (events.length === 0 && toolUseResult) {
      events.push({ type: "tool_result", data: { ...toolUseResult, content: message?.["content"] } });
    }

    return events;
  }

  extractTokenUsage(events: AgentEvent[]): TokenUsage | null {
    // Find the last token_usage or completion event
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (!event) continue;
      const data = event.data as Record<string, unknown> | null;
      const usage = data?.["usage"] as Record<string, unknown> | undefined;
      if ((event.type === "completion" || event.type === "token_usage") && usage) {
        const input = Number(usage["input_tokens"]) || 0;
        const output = Number(usage["output_tokens"]) || 0;
        const cacheCreation = Number(usage["cache_creation_input_tokens"]) || 0;
        const cacheRead = Number(usage["cache_read_input_tokens"]) || 0;
        return {
          inputTokens: input,
          outputTokens: output,
          totalTokens: input + output,
          cacheCreationInputTokens: cacheCreation || undefined,
          cacheReadInputTokens: cacheRead || undefined,
        };
      }
    }
    return null;
  }

  formatPermissionResponse(requestId: string, approved: boolean): string {
    return JSON.stringify({ request_id: requestId, approved }) + "\n";
  }

  /** Extract the session ID from the result event for later --resume use. */
  extractSessionId(events: AgentEvent[]): string | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (!event) continue;
      if (event.type === "completion") {
        const data = event.data as Record<string, unknown> | null;
        const sessionId = data?.["session_id"] as string | undefined;
        if (sessionId) return sessionId;
      }
    }
    return null;
  }
}
