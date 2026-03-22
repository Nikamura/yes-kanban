import { describe, test, expect } from "bun:test";
import { PlainTextAdapter } from "./plain-text";

describe("PlainTextAdapter MCP integration", () => {
  const adapter = new PlainTextAdapter("codex");

  test("accepts mcpConfigPath but ignores it", () => {
    const result = adapter.buildCommand({
      config: { command: "codex", args: [], env: {} } as any,
      prompt: "Fix the bug",
      cwd: "/tmp/workspace",
      mcpConfigPath: "/tmp/yes-kanban-mcp-ws123.json",
    });
    // Plain text adapters don't support MCP, so no --mcp-config flag
    expect(result.args).not.toContain("--mcp-config");
  });
});
