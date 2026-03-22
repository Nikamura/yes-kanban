import { describe, expect, it } from "bun:test";
import { TERMINAL_COLUMN_NAMES } from "./boardConstants";

describe("TERMINAL_COLUMN_NAMES", () => {
  it("includes Done only", () => {
    expect(TERMINAL_COLUMN_NAMES).toContain("Done");
    expect(TERMINAL_COLUMN_NAMES).toHaveLength(1);
  });
});
