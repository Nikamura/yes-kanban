import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

/**
 * Split a unified diff fragment from Cursor's editToolCall into old/new text
 * for the log diff UI. Context lines go to both sides; @@ and ---/+++ headers skipped.
 */
export function parseDiffString(diff: string): { oldString: string; newString: string } {
  if (!diff.trim()) {
    return { oldString: "", newString: "" };
  }
  const oldParts: string[] = [];
  const newParts: string[] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("+") && !line.startsWith("+++")) {
      newParts.push(line.slice(1));
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      oldParts.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      const text = line.slice(1);
      oldParts.push(text);
      newParts.push(text);
    }
  }
  return {
    oldString: oldParts.join("\n"),
    newString: newParts.join("\n"),
  };
}

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

    if (args.config.effort) {
      cmdArgs.push("--reasoning-effort", args.config.effort);
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
          const output = this.extractToolResultContent(parsed);
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
   * Cursor nests tool info under tool_call.shellToolCall / tool_call.grepToolCall etc.
   * Args are nested under toolCall[key].args with different field names than Claude Code.
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

    // Cursor uses editToolCall (not fileEditToolCall) with args.path and args.streamContent
    if (toolCall["editToolCall"] || toolCall["fileEditToolCall"]) {
      const edit = (toolCall["editToolCall"] ?? toolCall["fileEditToolCall"]) as Record<string, unknown>;
      const args = edit["args"] as Record<string, unknown> | undefined;
      const rawOld =
        (args?.["oldString"] as string | undefined) ??
        (edit["oldString"] as string | undefined) ??
        (edit["old_string"] as string | undefined) ??
        "";
      const rawNew =
        (args?.["newString"] as string | undefined) ??
        (edit["newString"] as string | undefined) ??
        (edit["new_string"] as string | undefined) ??
        "";
      const diffStr = args?.["diffString"] as string | undefined;
      const parsed =
        !rawOld && !rawNew && diffStr ? parseDiffString(diffStr) : { oldString: rawOld, newString: rawNew };
      return {
        name: "Edit",
        input: {
          file_path: args?.["path"] ?? edit["filePath"] ?? edit["file_path"] ?? "unknown",
          old_string: parsed.oldString,
          new_string: parsed.newString,
          lines_added: args?.["linesAdded"],
          lines_removed: args?.["linesRemoved"],
        },
        tool_use_id: callId,
      };
    }

    if (toolCall["readToolCall"]) {
      const read = toolCall["readToolCall"] as Record<string, unknown>;
      const args = read["args"] as Record<string, unknown> | undefined;
      return {
        name: "Read",
        input: {
          file_path: args?.["path"] ?? read["filePath"] ?? read["file_path"] ?? "unknown",
          offset: args?.["offset"] ?? read["offset"],
          limit: args?.["limit"] ?? read["limit"],
        },
        tool_use_id: callId,
      };
    }

    if (toolCall["writeToolCall"]) {
      const write = toolCall["writeToolCall"] as Record<string, unknown>;
      const args = write["args"] as Record<string, unknown> | undefined;
      return {
        name: "Write",
        input: {
          file_path: args?.["path"] ?? write["filePath"] ?? write["file_path"] ?? "unknown",
          content: args?.["content"] ?? write["content"] ?? "",
        },
        tool_use_id: callId,
      };
    }

    // Cursor uses grepToolCall (not searchToolCall)
    if (toolCall["grepToolCall"] || toolCall["searchToolCall"]) {
      const grep = (toolCall["grepToolCall"] ?? toolCall["searchToolCall"]) as Record<string, unknown>;
      const args = grep["args"] as Record<string, unknown> | undefined;
      return {
        name: "Grep",
        input: {
          pattern: args?.["pattern"] ?? grep["query"] ?? grep["pattern"] ?? "",
          path: args?.["path"] ?? grep["path"],
        },
        tool_use_id: callId,
      };
    }

    // Cursor uses globToolCall (not listToolCall)
    if (toolCall["globToolCall"] || toolCall["listToolCall"]) {
      const glob = (toolCall["globToolCall"] ?? toolCall["listToolCall"]) as Record<string, unknown>;
      const args = glob["args"] as Record<string, unknown> | undefined;
      return {
        name: "Glob",
        input: {
          pattern: args?.["globPattern"] ?? glob["pattern"] ?? "*",
          path: args?.["targetDirectory"] ?? glob["path"],
        },
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
    // Text-only user messages (prompt echo) should not render as raw lines
    // Return a system event to suppress them instead of empty array (which falls through to raw line)
    if (events.length === 0) {
      return [{ type: "unknown", data: parsed }];
    }
    return events;
  }

  /**
   * Extract tool result content from a completed tool_call event.
   * Cursor nests results inside `tool_call[key].result.success.content` or at `parsed.result.stdout`.
   */
  private extractToolResultContent(parsed: Record<string, unknown>): string {
    // Check top-level result (older format)
    const topResult = parsed["result"] as Record<string, unknown> | undefined;
    if (topResult) {
      const stdout = topResult["stdout"] as string | undefined;
      if (stdout) return stdout;
      const interleaved = topResult["interleavedOutput"] as string | undefined;
      if (interleaved) return interleaved;
    }

    // Walk the tool_call object to find .result.success.content
    const toolCall = parsed["tool_call"] as Record<string, unknown> | undefined;
    if (toolCall) {
      for (const key of Object.keys(toolCall)) {
        const call = toolCall[key] as Record<string, unknown> | undefined;
        if (!call) continue;
        const result = call["result"] as Record<string, unknown> | undefined;
        if (!result) continue;
        const success = result["success"] as Record<string, unknown> | undefined;
        if (success) {
          // Read tool: success.content is the file contents
          if (typeof success["content"] === "string") return success["content"];
          // Grep tool: success.workspaceResults has matches
          if (success["workspaceResults"]) return JSON.stringify(success["workspaceResults"]);
          // Other tools: stringify success
          return JSON.stringify(success);
        }
        // Check for error result
        const error = result["error"] as string | undefined;
        if (error) return `Error: ${error}`;
      }
    }

    return "";
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
