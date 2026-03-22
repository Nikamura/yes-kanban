import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

const TOOL_ITEM_TYPES = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search"]);

/**
 * Adapter for Codex CLI using `codex exec --json` for structured JSONL output.
 */
export class CodexAdapter implements IAgentAdapter {
  buildCommand(args: {
    config: Doc<"agentConfigs">;
    prompt: string;
    cwd: string;
    mcpConfigPath?: string;
    permissionMode?: "plan" | "dangerously-skip-permissions" | "accept";
  }): { command: string; args: string[]; env: Record<string, string> } {
    const mode = args.permissionMode ?? "dangerously-skip-permissions";
    const cmdArgs: string[] = ["exec", "--json"];

    // Permission mode
    if (mode === "dangerously-skip-permissions") {
      cmdArgs.push("--yolo");
    } else {
      // "accept" and "plan" both map to --full-auto (no read-only equivalent in exec mode)
      cmdArgs.push("--full-auto");
    }

    if (args.config.model) {
      cmdArgs.push("-m", args.config.model);
    }

    if (args.config.args.length > 0) {
      cmdArgs.push(...args.config.args);
    }

    // Prompt is the positional argument (must be last)
    cmdArgs.push(args.prompt);

    return {
      command: args.config.command,
      args: cmdArgs,
      env: { ...process.env, ...(args.config.env ?? {}) } as Record<string, string>,
    };
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

  extractSessionId(_events: AgentEvent[]): string | null {
    return null;
  }
}
