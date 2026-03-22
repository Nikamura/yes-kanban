import { describe, test, expect } from "bun:test";
import { CursorAdapter } from "./cursor";

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  describe("buildCommand", () => {
    test("builds command with prompt and stream-json", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: {} } as any,
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.command).toBe("agent");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("Fix the bug");
      expect(result.args).toContain("--output-format");
      expect(result.args).toContain("stream-json");
      expect(result.args).toContain("--workspace");
      expect(result.args).toContain("/tmp/workspace");
    });

    test("uses --force for dangerously-skip-permissions mode", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
        permissionMode: "dangerously-skip-permissions",
      });
      expect(result.args).toContain("--force");
      expect(result.args).not.toContain("--dangerously-skip-permissions");
    });

    test("defaults to --force when no permission mode specified", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--force");
    });

    test("uses --mode plan with --trust for plan permission mode", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: {} } as any,
        prompt: "Review code",
        cwd: "/tmp",
        permissionMode: "plan",
      });
      expect(result.args).toContain("--mode");
      expect(result.args).toContain("plan");
      expect(result.args).toContain("--trust");
      expect(result.args).not.toContain("--force");
    });

    test("includes model when specified", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], model: "gpt-4o", env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("gpt-4o");
    });

    test("uses --resume when sessionId provided", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: {} } as any,
        prompt: "Continue work",
        cwd: "/tmp",
        sessionId: "sess_abc123",
      });
      expect(result.args).toContain("--resume");
      expect(result.args).toContain("sess_abc123");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("Continue work");
    });

    test("adds --approve-mcps when mcpConfigPath is provided", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
        mcpConfigPath: "/tmp/mcp.json",
      });
      expect(result.args).toContain("--approve-mcps");
    });

    test("does not add --approve-mcps without mcpConfigPath", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).not.toContain("--approve-mcps");
    });

    test("passes additional args from config", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: ["--workspace", "/my/dir"], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--workspace");
      expect(result.args).toContain("/my/dir");
      // Should not duplicate --workspace when config already specifies it
      expect(result.args.filter((a: string) => a === "--workspace")).toHaveLength(1);
    });

    test("merges environment variables", () => {
      const result = adapter.buildCommand({
        config: { command: "agent", args: [], env: { MY_KEY: "val" } } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.env["MY_KEY"]).toBe("val");
    });
  });

  describe("parseLine", () => {
    test("parses system event", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "system",
        subtype: "init",
        model: "gpt-4o",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("system");
    });

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
            { type: "tool_use", id: "tool_123", name: "Read", input: { file_path: "/etc/hosts" } },
          ],
        },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
      const data = events[0]!.data as any;
      expect(data.name).toBe("Read");
    });

    test("splits assistant message with text and tool_use blocks", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me read the file." },
            { type: "tool_use", id: "tool_123", name: "Read", input: { file_path: "/tmp/f" } },
          ],
        },
      }));
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("assistant_message");
      expect(events[1]!.type).toBe("tool_use");
    });

    test("parses tool_call started as tool_use with flat format", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_call",
        subtype: "started",
        name: "edit_file",
        input: { path: "/tmp/foo.ts" },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
      const data = events[0]!.data as any;
      expect(data.name).toBe("edit_file");
      expect(data.input).toEqual({ path: "/tmp/foo.ts" });
    });

    test("parses tool_call started with nested shellToolCall", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "tool_abc123",
        tool_call: {
          shellToolCall: {
            args: { command: "git status && git diff --stat" },
          },
        },
        description: "Show git status",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
      const data = events[0]!.data as any;
      expect(data.name).toBe("Bash");
      expect(data.input.command).toBe("git status && git diff --stat");
      expect(data.input.description).toBe("Show git status");
      expect(data.tool_use_id).toBe("tool_abc123");
    });

    test("parses tool_call started with nested fileEditToolCall", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "tool_edit1",
        tool_call: {
          fileEditToolCall: {
            filePath: "/tmp/foo.ts",
            oldString: "const x = 1",
            newString: "const x = 2",
          },
        },
      }));
      expect(events).toHaveLength(1);
      const data = events[0]!.data as any;
      expect(data.name).toBe("Edit");
      expect(data.input.file_path).toBe("/tmp/foo.ts");
      expect(data.tool_use_id).toBe("tool_edit1");
    });

    test("parses tool_call started with nested readToolCall", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "tool_read1",
        tool_call: {
          readToolCall: { filePath: "/tmp/file.ts" },
        },
      }));
      expect(events).toHaveLength(1);
      const data = events[0]!.data as any;
      expect(data.name).toBe("Read");
      expect(data.input.file_path).toBe("/tmp/file.ts");
    });

    test("parses tool_call completed as tool_result with output", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "tool_abc123",
        tool_call: {
          shellToolCall: {
            args: { command: "git status" },
          },
        },
        result: {
          success: true,
          stdout: "On branch main\nnothing to commit",
          exitCode: 0,
        },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_result");
      const data = events[0]!.data as any;
      expect(data.name).toBe("Bash");
      expect(data.content).toBe("On branch main\nnothing to commit");
      expect(data.tool_use_id).toBe("tool_abc123");
    });

    test("parses tool_call completed with flat format", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        name: "edit_file",
        input: { path: "/tmp/foo.ts" },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_result");
    });

    test("parses tool_call with unknown subtype as unknown", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_call",
        subtype: "unknown_subtype",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("unknown");
    });

    test("extracts tool_result from user message", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tool_123", content: "file contents" },
          ],
        },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_result");
    });

    test("parses result as completion", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "result",
        usage: { input_tokens: 100, output_tokens: 50 },
        session_id: "sess_abc",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("completion");
    });

    test("parses error event", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "error", message: "fail" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("error");
    });

    test("parses usage event", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "usage",
        usage: { input_tokens: 500, output_tokens: 200 },
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("token_usage");
    });

    test("returns empty for non-JSON", () => {
      expect(adapter.parseLine("plain text output")).toHaveLength(0);
    });

    test("returns unknown for unrecognized JSON type", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "custom", data: 1 }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("unknown");
    });
  });

  describe("extractTokenUsage", () => {
    test("extracts from completion event", () => {
      const usage = adapter.extractTokenUsage([
        { type: "assistant_message", data: {} },
        { type: "completion", data: { usage: { input_tokens: 1000, output_tokens: 500 } } },
      ]);
      expect(usage).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });
    });

    test("extracts from token_usage event", () => {
      const usage = adapter.extractTokenUsage([
        { type: "token_usage", data: { usage: { input_tokens: 200, output_tokens: 100 } } },
      ]);
      expect(usage).toEqual({
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      });
    });

    test("returns null when no usage data", () => {
      const usage = adapter.extractTokenUsage([
        { type: "assistant_message", data: {} },
      ]);
      expect(usage).toBeNull();
    });
  });

  describe("extractSessionId", () => {
    test("extracts session ID from completion event", () => {
      const sessionId = adapter.extractSessionId([
        { type: "assistant_message", data: {} },
        { type: "completion", data: { session_id: "sess_xyz789" } },
      ]);
      expect(sessionId).toBe("sess_xyz789");
    });

    test("returns null when no session ID", () => {
      const sessionId = adapter.extractSessionId([
        { type: "completion", data: {} },
      ]);
      expect(sessionId).toBeNull();
    });
  });

  describe("formatPermissionResponse", () => {
    test("throws error", () => {
      expect(() => adapter.formatPermissionResponse("req_123", true)).toThrow(
        "Cursor adapter does not support permission responses",
      );
    });
  });
});
