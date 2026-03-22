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

    // Permission mode — "accept" falls through with no flags (Cursor default interactive mode)
    const mode = args.permissionMode ?? "dangerously-skip-permissions";
    if (mode === "dangerously-skip-permissions") {
      cmdArgs.push("--force");
    } else if (mode === "plan") {
      // --trust bypasses workspace trust prompt without skipping all permissions like --force
      cmdArgs.push("--mode", "plan", "--trust");
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

    // Note: Cursor CLI has no --max-turns flag. Runaway sessions are bounded
    // by the executor's overall timeout and stall detection instead.

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
          return [{ type: "tool_use", data: this.normalizeToolData(parsed) }];
        }
        if (parsed.subtype === "completed") {
          const normalized = this.normalizeToolData(parsed);
          const result = parsed.result as Record<string, unknown> | undefined;
          const output = (result?.["stdout"] as string | undefined) ?? (result?.["interleavedOutput"] as string | undefined) ?? "";
          return [{ type: "tool_result", data: { ...normalized, content: output, tool_use_id: normalized["tool_use_id"] } }];
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

  /**
   * Normalize Cursor tool_call data to the shape ToolRenderers expect: { name, input, tool_use_id }.
   * Cursor nests tool info under tool_call.shellToolCall / tool_call.fileEditToolCall etc.
   */
  private normalizeToolData(parsed: Record<string, unknown>): Record<string, unknown> {
    const callId = parsed["call_id"] as string | undefined;
    const toolCall = parsed["tool_call"] as Record<string, unknown> | undefined;
    const description = parsed["description"] as string | undefined;

    // If the event already has top-level name/input (test/simple format), use it directly
    if (parsed["name"] && parsed["input"]) {
      return { name: parsed["name"], input: parsed["input"], tool_use_id: callId };
    }

    if (!toolCall) {
      return { name: "unknown", tool_use_id: callId };
    }

    if (toolCall["shellToolCall"]) {
      const shell = toolCall["shellToolCall"] as Record<string, unknown>;
      const args = shell["args"] as Record<string, unknown> | undefined;
      const command = (args?.["command"] as string | undefined) ?? "";
      return { name: "Bash", input: { command, description: description ?? "" }, tool_use_id: callId };
    }

    if (toolCall["fileEditToolCall"]) {
      const edit = toolCall["fileEditToolCall"] as Record<string, unknown>;
      return {
        name: "Edit",
        input: {
          file_path: edit["filePath"] ?? edit["file_path"] ?? "unknown",
          old_string: edit["oldString"] ?? edit["old_string"] ?? "",
          new_string: edit["newString"] ?? edit["new_string"] ?? "",
        },
        tool_use_id: callId,
      };
    }

    if (toolCall["readToolCall"]) {
      const read = toolCall["readToolCall"] as Record<string, unknown>;
      return {
        name: "Read",
        input: { file_path: read["filePath"] ?? read["file_path"] ?? "unknown" },
        tool_use_id: callId,
      };
    }

    if (toolCall["writeToolCall"]) {
      const write = toolCall["writeToolCall"] as Record<string, unknown>;
      return {
        name: "Write",
        input: {
          file_path: write["filePath"] ?? write["file_path"] ?? "unknown",
          content: write["content"] ?? "",
        },
        tool_use_id: callId,
      };
    }

    if (toolCall["searchToolCall"]) {
      const search = toolCall["searchToolCall"] as Record<string, unknown>;
      return {
        name: "Grep",
        input: { pattern: search["query"] ?? search["pattern"] ?? "", path: search["path"] },
        tool_use_id: callId,
      };
    }

    if (toolCall["listToolCall"]) {
      const list = toolCall["listToolCall"] as Record<string, unknown>;
      return {
        name: "Glob",
        input: { pattern: list["pattern"] ?? "*", path: list["path"] },
        tool_use_id: callId,
      };
    }

    // Fallback: use first key as tool type
    const keys = Object.keys(toolCall).filter((k) => k.endsWith("ToolCall") || k.endsWith("Call"));
    const toolType = keys[0] ?? "unknown";
    return { name: toolType.replace(/ToolCall$|Call$/, ""), input: toolCall[toolType], tool_use_id: callId };
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
