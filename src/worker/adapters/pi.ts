import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

/**
 * Adapter for pi.dev coding agent using its RPC mode.
 * Communicates via stdin/stdout JSONL over `pi --mode rpc`.
 */
export class PiAdapter implements IAgentAdapter {
  needsStdin = true;
  handlesPermissions = true;

  buildCommand(args: {
    config: Doc<"agentConfigs">;
    prompt: string;
    cwd: string;
    mcpConfigPath?: string;
  }): { command: string; args: string[]; env: Record<string, string> } {
    const cmdArgs: string[] = ["--mode", "rpc", "--no-session"];

    if (args.config.model) {
      cmdArgs.push("--model", args.config.model);
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

  getInitialStdinMessage(prompt: string): string | null {
    return JSON.stringify({ type: "prompt", message: prompt }) + "\n";
  }

  formatPermissionResponse(requestId: string, approved: boolean): string {
    return JSON.stringify({ type: "extension_ui_response", id: requestId, confirmed: approved }) + "\n";
  }

  parseLine(line: string): AgentEvent[] {
    try {
      const parsed = JSON.parse(line);
      const type = parsed.type as string | undefined;

      if (type === "message_update") {
        return this.handleMessageUpdate(parsed);
      }
      if (type === "tool_execution_start") {
        return [{ type: "tool_use", data: parsed }];
      }
      if (type === "tool_execution_end") {
        return [{ type: "tool_result", data: parsed }];
      }
      if (type === "extension_ui_request") {
        const uiType = parsed.ui_type as string | undefined;
        if (uiType === "confirm") {
          return [{ type: "permission_request", data: parsed }];
        }
        return [{ type: "unknown", data: parsed }];
      }
      if (type === "agent_start" || type === "agent_end" || type === "turn_start" || type === "turn_end") {
        return [{ type: "system", data: parsed }];
      }

      return [{ type: "unknown", data: parsed }];
    } catch {
      return [];
    }
  }

  private handleMessageUpdate(parsed: Record<string, unknown>): AgentEvent[] {
    const subtype = parsed["subtype"] as string | undefined;

    if (subtype === "text_delta") {
      return [{ type: "assistant_message", data: parsed }];
    }

    if (subtype === "done") {
      const events: AgentEvent[] = [{ type: "completion", data: parsed }];
      const usage = parsed["usage"] as Record<string, unknown> | undefined;
      if (usage) {
        events.push({ type: "token_usage", data: { usage } });
      }
      return events;
    }

    return [{ type: "assistant_message", data: parsed }];
  }

  extractTokenUsage(events: AgentEvent[]): TokenUsage | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.type !== "token_usage") continue;
      const data = event.data as Record<string, unknown>;
      const usage = data["usage"] as Record<string, unknown> | undefined;
      if (!usage) continue;

      const input = Number(usage["input"] ?? usage["input_tokens"]) || 0;
      const output = Number(usage["output"] ?? usage["output_tokens"]) || 0;
      const total = Number(usage["totalTokens"]) || input + output;

      return {
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
      };
    }
    return null;
  }

  extractSessionId(_events: AgentEvent[]): string | null {
    return null;
  }
}
