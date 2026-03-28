import { describe, test, expect } from "bun:test";
import { getAdapter } from "./index";
import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";
import { CursorAdapter } from "./cursor";
import { OpenCodeAdapter } from "./opencode";

describe("getAdapter", () => {
  test("returns ClaudeCodeAdapter for claude-code", () => {
    const adapter = getAdapter("claude-code");
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
  });

  test("returns CodexAdapter for codex", () => {
    const adapter = getAdapter("codex");
    expect(adapter).toBeInstanceOf(CodexAdapter);
  });

  test("returns CursorAdapter for cursor", () => {
    const adapter = getAdapter("cursor");
    expect(adapter).toBeInstanceOf(CursorAdapter);
  });

  test("returns OpenCodeAdapter for opencode", () => {
    const adapter = getAdapter("opencode");
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
  });

  test("throws on unknown agent type", () => {
    expect(() => getAdapter("unknown-agent")).toThrow(/Unsupported agent type: unknown-agent/);
  });

  test("throws on removed legacy agent type pi", () => {
    expect(() => getAdapter("pi")).toThrow(/Unsupported agent type: pi/);
  });

  test("all adapters implement IAgentAdapter interface", () => {
    for (const type of ["claude-code", "codex", "cursor", "opencode"]) {
      const adapter = getAdapter(type);
      expect(typeof adapter.buildCommand).toBe("function");
      expect(typeof adapter.parseLine).toBe("function");
      expect(typeof adapter.extractTokenUsage).toBe("function");
    }
  });
});
