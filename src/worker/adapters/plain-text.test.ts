import { describe, test, expect } from "bun:test";
import { PlainTextAdapter } from "./plain-text";

describe("PlainTextAdapter", () => {
  describe("buildCommand", () => {
    test("cursor: uses -p flag with prompt", () => {
      const adapter = new PlainTextAdapter("cursor");
      const result = adapter.buildCommand({
        config: { command: "cursor-agent", args: [], env: {} } as any,
        prompt: "Refactor",
        cwd: "/tmp",
      });
      expect(result.command).toBe("cursor-agent");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("Refactor");
    });

    test("includes model when specified", () => {
      const adapter = new PlainTextAdapter("cursor");
      const result = adapter.buildCommand({
        config: { command: "npx", args: [], model: "gpt-4", env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--model");
      expect(result.args).toContain("gpt-4");
    });

    test("omits model when not specified", () => {
      const adapter = new PlainTextAdapter("cursor");
      const result = adapter.buildCommand({
        config: { command: "npx", args: [], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).not.toContain("--model");
    });

    test("passes additional args from config", () => {
      const adapter = new PlainTextAdapter("cursor");
      const result = adapter.buildCommand({
        config: { command: "npx", args: ["--verbose", "--timeout=60"], env: {} } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.args).toContain("--verbose");
      expect(result.args).toContain("--timeout=60");
    });

    test("merges environment variables from config", () => {
      const adapter = new PlainTextAdapter("cursor");
      const result = adapter.buildCommand({
        config: { command: "npx", args: [], env: { API_KEY: "secret" } } as any,
        prompt: "Task",
        cwd: "/tmp",
      });
      expect(result.env["API_KEY"]).toBe("secret");
    });
  });

  describe("parseLine", () => {
    test("always returns empty array", () => {
      const adapter = new PlainTextAdapter("cursor");
      expect(adapter.parseLine("some output")).toHaveLength(0);
      expect(adapter.parseLine(JSON.stringify({ type: "assistant" }))).toHaveLength(0);
      expect(adapter.parseLine("")).toHaveLength(0);
    });
  });

  describe("extractTokenUsage", () => {
    test("always returns null", () => {
      const adapter = new PlainTextAdapter("cursor");
      expect(adapter.extractTokenUsage([])).toBeNull();
      expect(adapter.extractTokenUsage([{ type: "completion", data: {} }])).toBeNull();
    });
  });
});
