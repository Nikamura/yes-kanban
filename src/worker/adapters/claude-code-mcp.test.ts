import { describe, test, expect } from "bun:test";
import { ClaudeCodeAdapter } from "./claude-code";

describe("ClaudeCodeAdapter MCP integration", () => {
  const adapter = new ClaudeCodeAdapter();

  test("adds --mcp-config flag when mcpConfigPath is provided", () => {
    const result = adapter.buildCommand({
      config: { command: "claude", args: [], env: {} } as any,
      prompt: "Fix the bug",
      cwd: "/tmp/workspace",
      mcpConfigPath: "/tmp/yes-kanban-mcp-ws123.json",
    });
    expect(result.args).toContain("--mcp-config");
    expect(result.args).toContain("/tmp/yes-kanban-mcp-ws123.json");
  });

  test("does not add --mcp-config flag when mcpConfigPath is undefined", () => {
    const result = adapter.buildCommand({
      config: { command: "claude", args: [], env: {} } as any,
      prompt: "Fix the bug",
      cwd: "/tmp/workspace",
    });
    expect(result.args).not.toContain("--mcp-config");
  });
});
