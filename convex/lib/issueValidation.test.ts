import { describe, it, expect } from "bun:test";
import { validateChecklistItemText, MAX_CHECKLIST_ITEMS } from "./issueValidation";

describe("validateChecklistItemText", () => {
  it("trims whitespace and returns text", () => {
    expect(validateChecklistItemText("  hello  ")).toBe("hello");
  });

  it("rejects empty string", () => {
    expect(() => validateChecklistItemText("")).toThrow("must not be empty");
  });

  it("rejects whitespace-only string", () => {
    expect(() => validateChecklistItemText("   ")).toThrow("must not be empty");
  });

  it("rejects text over 1000 characters", () => {
    expect(() => validateChecklistItemText("a".repeat(1001))).toThrow("1000 characters");
  });

  it("accepts text at exactly 1000 characters", () => {
    expect(validateChecklistItemText("a".repeat(1000))).toBe("a".repeat(1000));
  });
});

describe("MAX_CHECKLIST_ITEMS", () => {
  it("is 100", () => {
    expect(MAX_CHECKLIST_ITEMS).toBe(100);
  });
});
