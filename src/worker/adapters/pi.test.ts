import { describe, test, expect } from "bun:test";
import { PiAdapter } from "./pi";

describe("PiAdapter", () => {
  const adapter = new PiAdapter();

  describe("buildCommand", () => {
    test("builds command with rpc mode and no-session", () => {
      const result = adapter.buildCommand({
        config: { command: "pi", args: [], env: {} } as any,
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.command).toBe("pi");
      expect(result.args).toContain("--mode");
      expect(result.args).toContain("rpc");
      expect(result.args).toContain("--no-session");
    });

    test("does not include prompt in args", () => {
      const result = adapter.buildCommand({
        config: { command: "pi", args: [], env: {} } as any,
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.args).not.toContain("Fix the bug");
      expect(result.args).not.toContain("-p");
    });

    test("includes model when specified", () => {
      const result = adapter.buildCommand({
        config: { command: "pi", args: [], model: "pi-model", env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("pi-model");
    });

    test("ignores mcpConfigPath", () => {
      const result = adapter.buildCommand({
        config: { command: "pi", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
        mcpConfigPath: "/tmp/mcp.json",
      });
      expect(result.args).not.toContain("--mcp-config");
      expect(result.args).not.toContain("/tmp/mcp.json");
    });

    test("passes additional args from config", () => {
      const result = adapter.buildCommand({
        config: { command: "pi", args: ["--verbose"], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--verbose");
    });
  });

  describe("needsStdin", () => {
    test("is true", () => {
      expect(adapter.needsStdin).toBe(true);
    });
  });

  describe("getInitialStdinMessage", () => {
    test("returns JSONL prompt message", () => {
      const msg = adapter.getInitialStdinMessage("Fix the bug");
      expect(msg).toBe('{"type":"prompt","message":"Fix the bug"}\n');
    });

    test("escapes special characters in prompt", () => {
      const msg = adapter.getInitialStdinMessage('say "hello"\nworld');
      const parsed = JSON.parse(msg!);
      expect(parsed.type).toBe("prompt");
      expect(parsed.message).toBe('say "hello"\nworld');
    });
  });

  describe("formatPermissionResponse", () => {
    test("formats approval response", () => {
      const msg = adapter.formatPermissionResponse("req-123", true);
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("extension_ui_response");
      expect(parsed.id).toBe("req-123");
      expect(parsed.confirmed).toBe(true);
    });

    test("formats rejection response", () => {
      const msg = adapter.formatPermissionResponse("req-456", false);
      const parsed = JSON.parse(msg);
      expect(parsed.confirmed).toBe(false);
    });
  });

  describe("parseLine", () => {
    test("parses message_update text_delta as assistant_message", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "message_update",
        subtype: "text_delta",
        text: "Hello",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("assistant_message");
    });

    test("parses message_update done as completion + token_usage", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "message_update",
        subtype: "done",
        usage: { input: 100, output: 50, totalTokens: 150 },
      }));
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("completion");
      expect(events[1]!.type).toBe("token_usage");
    });

    test("parses message_update done without usage as completion only", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "message_update",
        subtype: "done",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("completion");
    });

    test("parses tool_execution_start as tool_use", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_execution_start",
        name: "read_file",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
    });

    test("parses tool_execution_end as tool_result", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "tool_execution_end",
        name: "read_file",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_result");
    });

    test("parses extension_ui_request confirm as permission_request", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "extension_ui_request",
        ui_type: "confirm",
        id: "req-1",
        name: "write_file",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("permission_request");
    });

    test("parses extension_ui_request non-confirm as unknown", () => {
      const events = adapter.parseLine(JSON.stringify({
        type: "extension_ui_request",
        ui_type: "info",
      }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("unknown");
    });

    test("parses agent_start/end as system", () => {
      for (const type of ["agent_start", "agent_end", "turn_start", "turn_end"]) {
        const events = adapter.parseLine(JSON.stringify({ type }));
        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("system");
      }
    });

    test("returns empty for invalid JSON", () => {
      expect(adapter.parseLine("not json")).toEqual([]);
    });

    test("returns unknown for unrecognized event types", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "something_new" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("unknown");
    });
  });

  describe("extractTokenUsage", () => {
    test("extracts token usage from events", () => {
      const events = [
        { type: "assistant_message" as const, data: {} },
        { type: "token_usage" as const, data: { usage: { input: 100, output: 50, totalTokens: 150 } } },
      ];
      const usage = adapter.extractTokenUsage(events);
      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });

    test("returns null when no token_usage events", () => {
      const events = [
        { type: "assistant_message" as const, data: {} },
      ];
      expect(adapter.extractTokenUsage(events)).toBeNull();
    });

    test("uses last token_usage event", () => {
      const events = [
        { type: "token_usage" as const, data: { usage: { input: 10, output: 5, totalTokens: 15 } } },
        { type: "token_usage" as const, data: { usage: { input: 100, output: 50, totalTokens: 150 } } },
      ];
      const usage = adapter.extractTokenUsage(events);
      expect(usage!.inputTokens).toBe(100);
    });

    test("calculates totalTokens from input+output when totalTokens missing", () => {
      const events = [
        { type: "token_usage" as const, data: { usage: { input: 100, output: 50 } } },
      ];
      const usage = adapter.extractTokenUsage(events);
      expect(usage!.totalTokens).toBe(150);
    });
  });

  describe("extractSessionId", () => {
    test("returns null", () => {
      expect(adapter.extractSessionId([])).toBeNull();
    });
  });
});
