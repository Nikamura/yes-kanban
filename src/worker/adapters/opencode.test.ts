import { describe, test, expect } from "bun:test";
import { OpenCodeAdapter } from "./opencode";

describe("OpenCodeAdapter", () => {
  const adapter = new OpenCodeAdapter();

  const makeConfig = (
    overrides: Partial<{
      command: string;
      args: string[];
      model: string;
      env: Record<string, string>;
    }> = {},
  ) =>
    ({
      command: overrides.command ?? "opencode",
      args: overrides.args ?? [],
      model: overrides.model ?? undefined,
      effort: undefined,
      env: overrides.env ?? {},
    }) as any;

  describe("buildCommand", () => {
    test("uses run with --format json", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.args[0]).toBe("run");
      expect(result.args).toContain("--format");
      expect(result.args).toContain("json");
    });

    test("prompt is the last positional argument", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Fix the bug",
        cwd: "/tmp/workspace",
      });
      expect(result.args[result.args.length - 1]).toBe("Fix the bug");
    });

    test("adds --session before the prompt when resuming", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Continue",
        cwd: "/tmp",
        sessionId: "ses_abc123",
      });
      const sessionIdx = result.args.indexOf("--session");
      expect(sessionIdx).toBeGreaterThan(-1);
      expect(result.args[sessionIdx + 1]).toBe("ses_abc123");
      expect(result.args[result.args.length - 1]).toBe("Continue");
    });

    test("includes --model when set", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ model: "anthropic/claude-sonnet-4-5" }),
        prompt: "Task",
        cwd: "/tmp",
      });
      const mIdx = result.args.indexOf("--model");
      expect(mIdx).toBeGreaterThan(-1);
      expect(result.args[mIdx + 1]).toBe("anthropic/claude-sonnet-4-5");
    });

    test("permission modes map to the same command (no extra flags)", () => {
      const base = { config: makeConfig(), prompt: "x", cwd: "/tmp" } as const;
      const a = adapter.buildCommand({ ...base, permissionMode: "plan" });
      const b = adapter.buildCommand({ ...base, permissionMode: "accept" });
      const c = adapter.buildCommand({ ...base, permissionMode: "dangerously-skip-permissions" });
      expect(a.args).toEqual(b.args);
      expect(b.args).toEqual(c.args);
    });

    test("passes additional args from config before the prompt", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ args: ["--thinking", "--print-logs"] }),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--thinking");
      expect(result.args).toContain("--print-logs");
      expect(result.args[result.args.length - 1]).toBe("Task");
    });

    test("merges environment variables from config", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ env: { FOO: "bar" } }),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.env["FOO"]).toBe("bar");
    });

    test("uses command from config", () => {
      const result = adapter.buildCommand({
        config: makeConfig({ command: "npx opencode" }),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.command).toBe("npx opencode");
    });

    test("does not require mcpConfigPath in args (lifecycle writes opencode.json)", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
        mcpConfigPath: "/tmp/mcp.json",
      });
      expect(result.args).not.toContain("/tmp/mcp.json");
    });
  });

  describe("parseLine", () => {
    test("step_start → system (sessionID for resume)", () => {
      const line = JSON.stringify({
        type: "step_start",
        sessionID: "ses_494719016ffe85dkDMj0FPRbHK",
        part: { type: "step-start" },
      });
      const events = adapter.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("system");
      expect((events[0]!.data as { sessionID?: string }).sessionID).toBe("ses_494719016ffe85dkDMj0FPRbHK");
    });

    test("text → assistant_message with message.content", () => {
      const line = JSON.stringify({
        type: "text",
        sessionID: "ses_x",
        part: { type: "text", text: "Hello" },
      });
      const events = adapter.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("assistant_message");
      const data = events[0]!.data as { message: { content: Array<{ type: string; text: string }> } };
      expect(data.message.content).toEqual([{ type: "text", text: "Hello" }]);
    });

    test("tool_use completed → tool_use + tool_result", () => {
      const line = JSON.stringify({
        type: "tool_use",
        sessionID: "ses_x",
        part: {
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo hi", description: "say hi" },
            output: "hi\n",
          },
        },
      });
      const events = adapter.parseLine(line);
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("tool_use");
      expect(events[1]!.type).toBe("tool_result");
      const tu = events[0]!.data as { name: string; tool_use_id: string };
      const tr = events[1]!.data as { name: string; content: string; tool_use_id: string };
      expect(tu.name).toBe("Bash");
      expect(tu.tool_use_id).toBe("call_1");
      expect(tr.content).toBe("hi\n");
      expect(tr.tool_use_id).toBe("call_1");
    });

    test("tool_use non-completed → tool_use only", () => {
      const line = JSON.stringify({
        type: "tool_use",
        part: {
          callID: "c2",
          tool: "read",
          state: { status: "pending", input: { path: "/a.ts" } },
        },
      });
      const events = adapter.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tool_use");
    });

    test("step_finish → completion + token_usage when tokens present", () => {
      const line = JSON.stringify({
        type: "step_finish",
        sessionID: "ses_x",
        part: {
          type: "step-finish",
          reason: "stop",
          tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 2 } },
        },
      });
      const events = adapter.parseLine(line);
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("completion");
      expect(events[1]!.type).toBe("token_usage");
    });

    test("step_finish → completion only when no tokens", () => {
      const line = JSON.stringify({
        type: "step_finish",
        part: { type: "step-finish", reason: "tool-calls" },
      });
      const events = adapter.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("completion");
    });

    test("error → error", () => {
      const line = JSON.stringify({
        type: "error",
        sessionID: "ses_x",
        error: { name: "APIError", data: { message: "fail" } },
      });
      const events = adapter.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("error");
    });

    test("unknown type → unknown", () => {
      const events = adapter.parseLine(JSON.stringify({ type: "future_event" }));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("unknown");
    });

    test("non-JSON line → empty array", () => {
      expect(adapter.parseLine("not json")).toHaveLength(0);
      expect(adapter.parseLine("")).toHaveLength(0);
    });

    test("strips OSC terminal escape sequences before parsing", () => {
      const json = JSON.stringify({
        type: "step_start",
        sessionID: "ses_abc",
        part: { type: "step-start" },
      });
      // Simulate OpenCode prepending OSC title-setting sequences
      const lineWithEscapes = `\x1b]0;workspaceId: ready\x07\x1b]0;workspaceId: working\x07${json}`;
      const events = adapter.parseLine(lineWithEscapes);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("system");
      expect((events[0]!.data as { sessionID?: string }).sessionID).toBe("ses_abc");
    });

    test("strips bare ]0; sequences (without ESC prefix)", () => {
      const json = JSON.stringify({
        type: "text",
        part: { text: "Hello world" },
      });
      const lineWithBareOsc = `]0;abc: ready]0;abc: working${json}`;
      const events = adapter.parseLine(lineWithBareOsc);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("assistant_message");
    });

    test("pure escape sequences → empty array", () => {
      const pureTitleLine = `\x1b]0;workspaceId: ready\x07`;
      expect(adapter.parseLine(pureTitleLine)).toHaveLength(0);
    });
  });

  describe("extractTokenUsage", () => {
    test("extracts from token_usage event (nested tokens)", () => {
      const usage = adapter.extractTokenUsage([
        {
          type: "token_usage",
          data: {
            tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 3 } },
          },
        },
      ]);
      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 60,
        totalTokens: 160,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 3,
      });
    });

    test("uses last token_usage event", () => {
      const usage = adapter.extractTokenUsage([
        { type: "token_usage", data: { tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } },
        { type: "token_usage", data: { tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } } },
      ]);
      expect(usage?.inputTokens).toBe(200);
      expect(usage?.outputTokens).toBe(100);
    });

    test("returns null when no token_usage", () => {
      expect(adapter.extractTokenUsage([{ type: "completion", data: {} }])).toBeNull();
    });
  });

  describe("extractSessionId", () => {
    test("extracts sessionID from step_start system event", () => {
      const id = adapter.extractSessionId([
        { type: "system", data: { type: "step_start", sessionID: "ses_xyz" } },
        { type: "completion", data: {} },
      ]);
      expect(id).toBe("ses_xyz");
    });

    test("accepts session_id alias", () => {
      const id = adapter.extractSessionId([
        { type: "system", data: { type: "step_start", session_id: "ses_legacy" } },
      ]);
      expect(id).toBe("ses_legacy");
    });

    test("returns null when missing", () => {
      expect(adapter.extractSessionId([])).toBeNull();
    });
  });

  describe("formatPermissionResponse", () => {
    test("throws error", () => {
      expect(() => adapter.formatPermissionResponse("req-1", true)).toThrow(
        "does not support interactive permission",
      );
    });
  });
});
