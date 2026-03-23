import { describe, expect, it } from "bun:test";
import { TERMINAL_COLUMN_NAMES, isAgentForbiddenMoveTarget } from "./boardConstants";

describe("TERMINAL_COLUMN_NAMES", () => {
  it("includes Done only", () => {
    expect(TERMINAL_COLUMN_NAMES).toContain("Done");
    expect(TERMINAL_COLUMN_NAMES).toHaveLength(1);
  });
});

describe("isAgentForbiddenMoveTarget", () => {
  it("is true for agent moving to Done", () => {
    expect(isAgentForbiddenMoveTarget("Done", "agent")).toBe(true);
  });

  it("is false for user moving to Done", () => {
    expect(isAgentForbiddenMoveTarget("Done", "user")).toBe(false);
    expect(isAgentForbiddenMoveTarget("Done", undefined)).toBe(false);
  });

  it("is false for agent moving to non-terminal columns", () => {
    expect(isAgentForbiddenMoveTarget("In Progress", "agent")).toBe(false);
    expect(isAgentForbiddenMoveTarget("To Do", "agent")).toBe(false);
  });
});
