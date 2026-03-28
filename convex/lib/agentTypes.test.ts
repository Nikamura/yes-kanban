import { describe, test, expect } from "bun:test";
import {
  assertSupportedAgentAdapterType,
  isSupportedAgentAdapterType,
} from "./agentTypes";

describe("agentTypes", () => {
  test("isSupportedAgentAdapterType accepts current adapters", () => {
    expect(isSupportedAgentAdapterType("claude-code")).toBe(true);
    expect(isSupportedAgentAdapterType("codex")).toBe(true);
    expect(isSupportedAgentAdapterType("cursor")).toBe(true);
    expect(isSupportedAgentAdapterType("opencode")).toBe(true);
    expect(isSupportedAgentAdapterType("pi")).toBe(false);
    expect(isSupportedAgentAdapterType("nope")).toBe(false);
  });

  test("assertSupportedAgentAdapterType throws for legacy pi", () => {
    expect(() => assertSupportedAgentAdapterType("pi")).toThrow(
      /Unsupported agent type: pi/,
    );
  });
});
