import { describe, test, expect } from "bun:test";
import { ClaudeCodeAdapter } from "./claude-code";

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  describe("buildCommand", () => {
    test("builds command with required flags", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.command).toBe("claude");
      expect(result.args).toContain("--dangerously-skip-permissions");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("Fix the bug");
      expect(result.args).toContain("--output-format");
      expect(result.args).toContain("stream-json");
      expect(result.args).toContain("--verbose");
    });

    test("includes default --max-turns guard", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--max-turns");
      expect(result.args).toContain("200");
    });

    test("does not add --max-turns when config already has it", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: ["--max-turns", "5"], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      const maxTurnsCount = result.args.filter((a) => a === "--max-turns").length;
      expect(maxTurnsCount).toBe(1);
      expect(result.args).toContain("5");
    });

    test("includes model when specified", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], model: "sonnet", env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("sonnet");
    });

    test("includes --effort when config has effort", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], effort: "high", env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      const idx = result.args.indexOf("--effort");
      expect(idx).toBeGreaterThan(-1);
      expect(result.args[idx + 1]).toBe("high");
    });

    test("omits --effort when config has no effort", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).not.toContain("--effort");
    });

    test("passes additional args from config", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: ["--max-turns", "5"], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--max-turns");
      expect(result.args).toContain("5");
    });

    test("merges environment variables", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: { MY_KEY: "val" } } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.env["MY_KEY"]).toBe("val");
    });

    test("uses --resume when sessionId provided", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Continue work",
        cwd: "/tmp",
        sessionId: "sess_abc123",
      });
      expect(result.args).toContain("--resume");
      expect(result.args).toContain("sess_abc123");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("Continue work");
    });

    test("uses plan permission mode when specified", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Review code",
        cwd: "/tmp",
        permissionMode: "plan",
      });
      expect(result.args).toContain("--permission-mode");
      expect(result.args).toContain("plan");
      expect(result.args).not.toContain("--dangerously-skip-permissions");
    });

    test("uses accept mode — no permission flags", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Code task",
        cwd: "/tmp",
        permissionMode: "accept",
      });
      expect(result.args).not.toContain("--dangerously-skip-permissions");
      expect(result.args).not.toContain("--permission-mode");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("Code task");
    });

    test("includes MCP config path", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
        mcpConfigPath: "/tmp/mcp.json",
      });
      expect(result.args).toContain("--mcp-config");
      expect(result.args).toContain("/tmp/mcp.json");
    });

    test("adds --strict-mcp-config when mcpConfigPath is present", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
        mcpConfigPath: "/tmp/mcp.json",
      });
      expect(result.args).toContain("--strict-mcp-config");
    });

    test("does not add --strict-mcp-config without mcpConfigPath", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).not.toContain("--strict-mcp-config");
    });

    test("disallows AskUserQuestion built-in tool", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--disallowedTools");
      const idx = result.args.indexOf("--disallowedTools");
      expect(result.args[idx + 1]).toBe("AskUserQuestion");
    });

    test("adds --settings when settingsPath is provided", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
        settingsPath: "/tmp/settings.json",
      });
      expect(result.args).toContain("--settings");
      expect(result.args).toContain("/tmp/settings.json");
    });

    test("does not add --settings without settingsPath", () => {
      const result = adapter.buildCommand({
        config: { command: "claude", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).not.toContain("--settings");
    });
  });

  describe("parseLine", () => {
    test("parses assistant text message", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("assistant_message");
    });

    test("extracts tool_use from assistant message content blocks", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "toolu_123", name: "Read", input: { file_path: "/etc/hosts" } },
          ],
        },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
      const data = events[0]!.data as any;
      expect(data.name).toBe("Read");
      expect(data.input.file_path).toBe("/etc/hosts");
    });

    test("splits assistant message with text and tool_use blocks", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me read the file." },
            { type: "tool_use", id: "toolu_123", name: "Read", input: { file_path: "/tmp/f" } },
          ],
        },
      }));
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("assistant_message");
      expect(events[1]!.type).toBe("tool_use");
    });

    test("extracts tool_result from user message", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_123", content: "file contents" },
          ],
        },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_result");
    });

    test("parses standalone tool_use event", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "tool_use", name: "edit" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
    });

    test("parses standalone tool_result event", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "tool_result", output: "done" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_result");
    });

    test("parses result/completion event", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "result", usage: { input_tokens: 100, output_tokens: 50 } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("completion");
    });

    test("parses error event", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "error", message: "fail" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("error");
    });

    test("parses system event", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-4-6" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("system");
    });

    test("filters out rate_limit_event", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} }));
      expect(events).toHaveLength(0);
    });

    test("filters out content_block_delta", () => {
      expect(adapter.parseLine(JSON.stringify({ type: "content_block_delta" }))).toHaveLength(0);
    });

    test("returns empty for non-JSON", () => {
      expect(adapter.parseLine("plain text output")).toHaveLength(0);
    });

    test("parses permission_request event", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "permission_request",
        request_id: "req_123",
        tool: { name: "Bash", input: { command: "rm -rf /tmp/test" } },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("permission_request");
      const data = events[0]!.data as any;
      expect(data.tool.name).toBe("Bash");
      expect(data.request_id).toBe("req_123");
    });

    test("returns unknown for unrecognized JSON", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "custom", data: 1 }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("unknown");
    });
  });

  describe("extractTokenUsage", () => {
    test("extracts from completion event without cache fields", () => {
      const usage = adapter.extractTokenUsage([
        { type: "assistant_message", data: {} },
        { type: "completion", data: { usage: { input_tokens: 1000, output_tokens: 500 } } },
      ]);
      expect(usage).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cacheCreationInputTokens: undefined,
        cacheReadInputTokens: undefined,
      });
    });

    test("extracts cache token fields when present", () => {
      const usage = adapter.extractTokenUsage([
        { type: "completion", data: { usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 3000,
        } } },
      ]);
      expect(usage).toEqual({
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700, // 500 + 200 (cache tokens tracked separately)
        cacheCreationInputTokens: 1000,
        cacheReadInputTokens: 3000,
      });
    });

    test("cache fields are undefined when zero", () => {
      const usage = adapter.extractTokenUsage([
        { type: "completion", data: { usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        } } },
      ]);
      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheCreationInputTokens: undefined,
        cacheReadInputTokens: undefined,
      });
    });

    test("returns null when no usage found", () => {
      const usage = adapter.extractTokenUsage([
        { type: "assistant_message", data: {} },
      ]);
      expect(usage).toBeNull();
    });
  });

  describe("extractSessionId", () => {
    test("extracts session_id from completion event", () => {
      const sessionId = adapter.extractSessionId([
        { type: "assistant_message", data: {} },
        { type: "completion", data: { session_id: "sess_abc123", usage: {} } },
      ]);
      expect(sessionId).toBe("sess_abc123");
    });

    test("returns null when no session_id present", () => {
      const sessionId = adapter.extractSessionId([
        { type: "completion", data: { usage: {} } },
      ]);
      expect(sessionId).toBeNull();
    });
  });
});
