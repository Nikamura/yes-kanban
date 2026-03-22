import { describe, test, expect } from "bun:test";
import { CodexAdapter } from "./codex";

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  const makeConfig = (overrides: Partial<{ command: string; args: string[]; model: string; env: Record<string, string> }> = {}) =>
    ({
      command: overrides.command ?? "codex",
      args: overrides.args ?? [],
      model: overrides.model ?? undefined,
      env: overrides.env ?? {},
    }) as any;

  describe("buildCommand", () => {
    test("uses exec --json subcommand", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.args[0]).toBe("exec");
      expect(result.args[1]).toBe("--json");
    });

    test("prompt is the last positional argument", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.args[result.args.length - 1]).toBe("Fix the bug");
    });

    test("dangerously-skip-permissions maps to --yolo", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
        permissionMode: "dangerously-skip-permissions",
      });
      expect(result.args).toContain("--yolo");
      expect(result.args).not.toContain("--full-auto");
    });

    test("defaults to --yolo when no permission mode specified", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--yolo");
    });

    test("accept maps to --full-auto", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
        permissionMode: "accept",
      });
      expect(result.args).toContain("--full-auto");
      expect(result.args).not.toContain("--yolo");
    });

    test("plan maps to --full-auto", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
        permissionMode: "plan",
      });
      expect(result.args).toContain("--full-auto");
    });

    test("includes model with -m flag", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ model: "o3" }),
        prompt: "Task",
        cwd: "/tmp",
      });
      const mIdx = result.args.indexOf("-m");
      expect(mIdx).toBeGreaterThan(-1);
      expect(result.args[mIdx + 1]).toBe("o3");
    });

    test("omits model when not specified", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).not.toContain("-m");
    });

    test("passes additional args from config", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ args: ["--verbose", "--timeout=60"] }),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--verbose");
      expect(result.args).toContain("--timeout=60");
      // prompt is still last
      expect(result.args[result.args.length - 1]).toBe("Task");
    });

    test("merges environment variables from config", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ env: { OPENAI_API_KEY: "sk-test" } }),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.env["OPENAI_API_KEY"]).toBe("sk-test");
    });

    test("uses command from config", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ command: "npx codex" }),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.command).toBe("npx codex");
    });
  });

  describe("parseLine", () => {
    test("thread.started → system", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "thread.started" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("system");
    });

    test("turn.started → system", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "turn.started" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("system");
    });

    test("item.started with command_execution → tool_use", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.started", item: { type: "command_execution" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
    });

    test("item.started with file_change → tool_use", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.started", item: { type: "file_change" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
    });

    test("item.started with mcp_tool_call → tool_use", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
    });

    test("item.started with web_search → tool_use", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.started", item: { type: "web_search" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
    });

    test("item.started with agent_message → assistant_message", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.started", item: { type: "agent_message" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("assistant_message");
    });

    test("item.started with reasoning → system", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.started", item: { type: "reasoning" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("system");
    });

    test("item.completed with command_execution → tool_result", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_result");
    });

    test("item.completed with agent_message → assistant_message", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message" } }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("assistant_message");
    });

    test("turn.completed → completion + token_usage", () => {
      const events = adapter.parseLine(
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 50 } }),
      );
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("completion");
      expect(events[1]!.type).toBe("token_usage");
    });

    test("turn.completed without usage → completion only", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "turn.completed" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("completion");
    });

    test("error → error", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "error", message: "something failed" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("error");
    });

    test("unknown event type → unknown", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "some.future.event" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("unknown");
    });

    test("non-JSON line → empty array", () => {
      expect(adapter.parseLine("not json")).toHaveLength(0);
      expect(adapter.parseLine("")).toHaveLength(0);
    });
  });

  describe("extractTokenUsage", () => {
    test("extracts usage from token_usage event", () => {
      const usage = adapter.extractTokenUsage([
        { type: "token_usage", data: { usage: { input_tokens: 100, output_tokens: 50 } } },
      ]);
      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: undefined,
      });
    });

    test("extracts cached_input_tokens", () => {
      const usage = adapter.extractTokenUsage([
        { type: "token_usage", data: { usage: { input_tokens: 200, output_tokens: 80, cached_input_tokens: 50 } } },
      ]);
      expect(usage).toEqual({
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
        cacheReadInputTokens: 50,
      });
    });

    test("uses last token_usage event", () => {
      const usage = adapter.extractTokenUsage([
        { type: "token_usage", data: { usage: { input_tokens: 10, output_tokens: 5 } } },
        { type: "token_usage", data: { usage: { input_tokens: 200, output_tokens: 100 } } },
      ]);
      expect(usage?.inputTokens).toBe(200);
      expect(usage?.outputTokens).toBe(100);
    });

    test("returns null for empty events", () => {
      expect(adapter.extractTokenUsage([])).toBeNull();
    });

    test("returns null when no token_usage events", () => {
      expect(adapter.extractTokenUsage([{ type: "completion", data: {} }])).toBeNull();
    });
  });

  describe("extractSessionId", () => {
    test("always returns null", () => {
      expect(adapter.extractSessionId([])).toBeNull();
      expect(adapter.extractSessionId([{ type: "completion", data: { session_id: "abc" } }])).toBeNull();
    });
  });

  describe("formatPermissionResponse", () => {
    test("throws error", () => {
      expect(() => adapter.formatPermissionResponse("req-1", true)).toThrow("does not support interactive permission");
    });
  });
});
