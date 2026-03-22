import { describe, test, expect } from "bun:test";
import { getAdapter } from "./index";
import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";
import { PiAdapter } from "./pi";
import { PlainTextAdapter } from "./plain-text";

describe("getAdapter", () => {
  test("returns ClaudeCodeAdapter for claude-code", () => {
    const adapter = getAdapter("claude-code");
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
  });

  test("returns PiAdapter for pi", () => {
    const adapter = getAdapter("pi");
    expect(adapter).toBeInstanceOf(PiAdapter);
  });

  test("returns CodexAdapter for codex", () => {
    const adapter = getAdapter("codex");
    expect(adapter).toBeInstanceOf(CodexAdapter);
  });

  test("returns PlainTextAdapter for gemini", () => {
    const adapter = getAdapter("gemini");
    expect(adapter).toBeInstanceOf(PlainTextAdapter);
  });

  test("returns PlainTextAdapter for cursor", () => {
    const adapter = getAdapter("cursor");
    expect(adapter).toBeInstanceOf(PlainTextAdapter);
  });

  test("throws on unknown agent type", () => {
    expect(() => getAdapter("unknown-agent")).toThrow("Unknown agent type: unknown-agent");
  });

  test("all adapters implement IAgentAdapter interface", () => {
    for (const type of ["claude-code", "pi", "codex", "gemini", "cursor"]) {
      const adapter = getAdapter(type);
      expect(typeof adapter.buildCommand).toBe("function");
      expect(typeof adapter.parseLine).toBe("function");
      expect(typeof adapter.extractTokenUsage).toBe("function");
    }
  });
});
