import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

    test("always includes --ephemeral and --skip-git-repo-check", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--ephemeral");
      expect(result.args).toContain("--skip-git-repo-check");
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
      expect(result.args).not.toContain("--sandbox");
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
      expect(result.args).not.toContain("--sandbox");
    });

    test("plan maps to --sandbox read-only", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
        permissionMode: "plan",
      });
      expect(result.args).not.toContain("--full-auto");
      expect(result.args).not.toContain("--yolo");
      const sandboxIdx = result.args.indexOf("--sandbox");
      expect(sandboxIdx).toBeGreaterThan(-1);
      expect(result.args[sandboxIdx + 1]).toBe("read-only");
      expect(result.args).not.toContain("--ask-for-approval");
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

    test("adds --no-project-doc when settingsPath is provided", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
        settingsPath: "/tmp/settings.json",
      });
      expect(result.args).toContain("--no-project-doc");
    });

    test("adds --no-project-doc when disableSlashCommands is true", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
        disableSlashCommands: true,
      });
      expect(result.args).toContain("--no-project-doc");
    });

    test("does not add --no-project-doc without settingsPath or disableSlashCommands", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).not.toContain("--no-project-doc");
    });

    test("uses resume subcommand when sessionId provided", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Continue the task",
        cwd: "/tmp",
        sessionId: "thread_abc123",
      });
      expect(result.args[0]).toBe("resume");
      expect(result.args[1]).toBe("thread_abc123");
      expect(result.args[2]).toBe("--json");
      expect(result.args).not.toContain("exec");
      // prompt is still last
      expect(result.args[result.args.length - 1]).toBe("Continue the task");
    });

    test("skips --ephemeral when resuming a session", () => {
      const result = adapter.buildCommand({
        config: makeConfig(),
        prompt: "Continue",
        cwd: "/tmp",
        sessionId: "thread_abc123",
      });
      expect(result.args).not.toContain("--ephemeral");
      expect(result.args).toContain("--skip-git-repo-check");
    });

    describe("MCP config via CODEX_HOME", () => {
      let tempConfigPath: string;
      let lastCodexHome: string | undefined;
      const testCwd = `/tmp/test-codex-mcp-${Date.now()}`;

      beforeEach(() => {
        lastCodexHome = undefined;
        tempConfigPath = `/tmp/test-codex-mcp-config-${Date.now()}.json`;
      });

      afterEach(() => {
        try { rmSync(tempConfigPath); } catch { /* ignore */ }
        if (lastCodexHome) {
          try { rmSync(lastCodexHome, { recursive: true }); } catch { /* ignore */ }
        }
      });

      const buildWithMcp = (overrides: Record<string, unknown> = {}) => {
        const result = adapter.buildCommand({
          config: makeConfig(),
          prompt: "Task",
          cwd: testCwd,
          mcpConfigPath: tempConfigPath,
          ...overrides,
        } as any);
        lastCodexHome = result.env["CODEX_HOME"];
        return result;
      };

      test("sets CODEX_HOME when mcpConfigPath provided", () => {
        const mcpConfig = {
          mcpServers: {
            "yes-kanban": { command: "bun", args: ["run", "/tmp/bridge.ts"] },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp();

        expect(result.env["CODEX_HOME"]).toBeDefined();
        expect(result.env["CODEX_HOME"]).toContain("yes-kanban-codex-home");
      });

      test("generates valid TOML config", () => {
        const mcpConfig = {
          mcpServers: {
            "yes-kanban": { command: "bun", args: ["run", "/tmp/bridge.ts"] },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp();

        const tomlContent = readFileSync(`${result.env["CODEX_HOME"]}/config.toml`, "utf-8");
        expect(tomlContent).toContain("[mcp_servers.yes-kanban]");
        expect(tomlContent).toContain('command = "bun"');
        expect(tomlContent).toContain('args = ["run", "/tmp/bridge.ts"]');
      });

      test("includes env vars in TOML config", () => {
        const mcpConfig = {
          mcpServers: {
            github: { command: "npx", args: ["-y", "@mcp/server-github"], env: { GITHUB_TOKEN: "tok_123" } },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp();

        const tomlContent = readFileSync(`${result.env["CODEX_HOME"]}/config.toml`, "utf-8");
        expect(tomlContent).toContain('env = { GITHUB_TOKEN = "tok_123" }');
      });

      test("includes enabled_tools when allowedTools match MCP server", () => {
        const mcpConfig = {
          mcpServers: {
            "yes-kanban": { command: "bun", args: ["run", "/tmp/bridge.ts"] },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp({
          allowedTools: ["mcp__yes-kanban__get_feedback", "mcp__yes-kanban__get_current_issue"],
        });

        const tomlContent = readFileSync(`${result.env["CODEX_HOME"]}/config.toml`, "utf-8");
        expect(tomlContent).toContain("enabled_tools");
        expect(tomlContent).toContain('"get_feedback"');
        expect(tomlContent).toContain('"get_current_issue"');
      });

      test("handles underscored server names in allowedTools", () => {
        const mcpConfig = {
          mcpServers: {
            "my_server": { command: "node", args: ["server.js"] },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp({
          allowedTools: ["mcp__my_server__do_thing"],
        });

        const tomlContent = readFileSync(`${result.env["CODEX_HOME"]}/config.toml`, "utf-8");
        expect(tomlContent).toContain("[mcp_servers.my_server]");
        expect(tomlContent).toContain('enabled_tools = ["do_thing"]');
      });

      test("escapes control characters in env values", () => {
        const mcpConfig = {
          mcpServers: {
            svc: { command: "node", args: ["s.js"], env: { MULTI: "line1\nline2\ttab" } },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp();

        const tomlContent = readFileSync(`${result.env["CODEX_HOME"]}/config.toml`, "utf-8");
        expect(tomlContent).toContain('MULTI = "line1\\nline2\\ttab"');
      });

      test("throws when mcpServers key is missing", () => {
        writeFileSync(tempConfigPath, JSON.stringify({ other: true }));
        expect(() => buildWithMcp()).toThrow("Missing or invalid 'mcpServers'");
      });

      test("throws when mcpServers is an array", () => {
        writeFileSync(tempConfigPath, JSON.stringify({ mcpServers: [] }));
        expect(() => buildWithMcp()).toThrow("Missing or invalid 'mcpServers'");
      });

      test("does not add enabled_tools for non-MCP allowed tools", () => {
        const mcpConfig = {
          mcpServers: {
            "yes-kanban": { command: "bun", args: ["run", "/tmp/bridge.ts"] },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp({
          allowedTools: ["Read", "Write", "Bash"],
        });

        const tomlContent = readFileSync(`${result.env["CODEX_HOME"]}/config.toml`, "utf-8");
        expect(tomlContent).not.toContain("enabled_tools");
      });

      test("cleanupCodexHome removes temp directory", () => {
        const mcpConfig = {
          mcpServers: {
            "yes-kanban": { command: "bun", args: ["run", "/tmp/bridge.ts"] },
          },
        };
        writeFileSync(tempConfigPath, JSON.stringify(mcpConfig));

        const result = buildWithMcp();
        const codexHome = result.env["CODEX_HOME"]!;
        expect(existsSync(codexHome)).toBe(true);

        adapter.cleanupCodexHome(result.env);
        expect(existsSync(codexHome)).toBe(false);
      });

      test("cleanupCodexHome ignores non-temp paths", () => {
        // Should not attempt to delete paths outside the expected prefix
        adapter.cleanupCodexHome({ CODEX_HOME: "/home/user/.codex" });
        // No error thrown
      });
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
    test("extracts thread_id from thread.started event", () => {
      const sessionId = adapter.extractSessionId([
        { type: "system", data: { type: "thread.started", thread_id: "thread_abc123" } },
        { type: "completion", data: {} },
      ]);
      expect(sessionId).toBe("thread_abc123");
    });

    test("returns null when no thread.started event", () => {
      const sessionId = adapter.extractSessionId([
        { type: "system", data: { type: "turn.started" } },
        { type: "completion", data: {} },
      ]);
      expect(sessionId).toBeNull();
    });

    test("returns null for empty events", () => {
      expect(adapter.extractSessionId([])).toBeNull();
    });

    test("returns null when thread.started has no thread_id", () => {
      const sessionId = adapter.extractSessionId([
        { type: "system", data: { type: "thread.started" } },
      ]);
      expect(sessionId).toBeNull();
    });
  });

  describe("formatPermissionResponse", () => {
    test("throws error", () => {
      expect(() => adapter.formatPermissionResponse("req-1", true)).toThrow("does not support interactive permission");
    });
  });
});
