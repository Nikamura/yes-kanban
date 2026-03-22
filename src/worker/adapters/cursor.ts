import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

export class CursorAdapter implements IAgentAdapter {
  buildCommand(args: {
    config: Doc<"agentConfigs">;
    prompt: string;
    cwd: string;
    mcpConfigPath?: string;
    sessionId?: string;
    permissionMode?: "plan" | "dangerously-skip-permissions" | "accept";
  }): { command: string; args: string[]; env: Record<string, string> } {
    const cmdArgs: string[] = [];

    // Prompt
    if (args.sessionId) {
      cmdArgs.push("--resume", args.sessionId, "-p", args.prompt);
    } else {
      cmdArgs.push("-p", args.prompt);
    }

    // Structured output
    cmdArgs.push("--output-format", "stream-json");

    // Workspace (only if not already specified in config args)
    if (!args.config.args.includes("--workspace")) {
      cmdArgs.push("--workspace", args.cwd);
    }

    // Permission mode
    const mode = args.permissionMode ?? "dangerously-skip-permissions";
    if (mode === "dangerously-skip-permissions") {
      cmdArgs.push("--force");
    } else if (mode === "plan") {
      cmdArgs.push("--mode", "plan");
    }

    // Model override
    if (args.config.model) {
      cmdArgs.push("--model", args.config.model);
    }

    // MCP: Cursor auto-detects .cursor/mcp.json in the workspace.
    // If mcpConfigPath is set, lifecycle.ts has already written the file.
    // We just need --approve-mcps to auto-approve MCP servers.
    if (args.mcpConfigPath) {
      cmdArgs.push("--approve-mcps");
    }

    // Custom args from config
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

      if (parsed.type === "system") {
        return [{ type: "system", data: parsed }];
      }

      if (parsed.type === "assistant") {
        return this.splitAssistantMessage(parsed);
      }

      if (parsed.type === "user") {
        return this.extractToolResults(parsed);
      }

      if (parsed.type === "tool_call") {
        if (parsed.subtype === "started") {
          return [{ type: "tool_use", data: parsed }];
        }
        if (parsed.subtype === "completed") {
          return [{ type: "tool_result", data: parsed }];
        }
        return [{ type: "unknown", data: parsed }];
      }

      if (parsed.type === "result") {
        return [{ type: "completion", data: parsed }];
      }

      if (parsed.type === "error") {
        return [{ type: "error", data: parsed }];
      }

      if (parsed.type === "usage") {
        return [{ type: "token_usage", data: parsed }];
      }

      return [{ type: "unknown", data: parsed }];
    } catch {
      return [];
    }
  }

  private splitAssistantMessage(parsed: Record<string, unknown>): AgentEvent[] {
    const message = parsed["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    if (!Array.isArray(content)) {
      return [{ type: "assistant_message", data: parsed }];
    }

    const events: AgentEvent[] = [];
    const textBlocks = content.filter((b: any) => b.type === "text");
    const toolBlocks = content.filter((b: any) => b.type === "tool_use");

    if (textBlocks.length > 0) {
      events.push({
        type: "assistant_message",
        data: { ...parsed, message: { ...message, content: textBlocks } },
      });
    }

    for (const block of toolBlocks) {
      events.push({
        type: "tool_use",
        data: { name: block.name, input: block.input, tool_use_id: block.id },
      });
    }

    if (events.length === 0) {
      events.push({ type: "assistant_message", data: parsed });
    }

    return events;
  }

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
    return events;
  }

  extractTokenUsage(events: AgentEvent[]): TokenUsage | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (!event) continue;
      const data = event.data as Record<string, unknown> | null;
      const usage = data?.["usage"] as Record<string, unknown> | undefined;
      if ((event.type === "completion" || event.type === "token_usage") && usage) {
        const input = Number(usage["input_tokens"]) || 0;
        const output = Number(usage["output_tokens"]) || 0;
        return {
          inputTokens: input,
          outputTokens: output,
          totalTokens: input + output,
        };
      }
    }
    return null;
  }

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

  formatPermissionResponse(_requestId: string, _approved: boolean): string {
    throw new Error("Cursor adapter does not support permission responses — use --force");
  }
}
