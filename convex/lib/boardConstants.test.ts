import { describe, it, expect } from "bun:test";
import { TERMINAL_COLUMN_NAMES } from "./boardConstants";

describe("TERMINAL_COLUMN_NAMES", () => {
  it("includes Done and Cancelled", () => {
    expect(TERMINAL_COLUMN_NAMES).toContain("Done");
    expect(TERMINAL_COLUMN_NAMES).toContain("Cancelled");
  });

  it("has exactly 2 entries", () => {
    expect(TERMINAL_COLUMN_NAMES).toHaveLength(2);
  });
});
