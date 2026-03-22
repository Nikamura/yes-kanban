import { describe, test, expect } from "bun:test";
import { validateIssueTitle, validateIssueDescription, validateCommentBody } from "./lib/issueValidation";

describe("validateIssueTitle", () => {
  test("returns trimmed title for valid input", () => {
    expect(validateIssueTitle("  Fix bug  ")).toBe("Fix bug");
  });

  test("rejects empty string", () => {
    expect(() => validateIssueTitle("")).toThrow("Title must not be empty");
  });

  test("rejects whitespace-only string", () => {
    expect(() => validateIssueTitle("   ")).toThrow("Title must not be empty");
  });

  test("rejects title over 500 characters", () => {
    expect(() => validateIssueTitle("a".repeat(501))).toThrow(
      "Title must be 500 characters or fewer"
    );
  });

  test("accepts title at exactly 500 characters", () => {
    const title = "a".repeat(500);
    expect(validateIssueTitle(title)).toBe(title);
  });
});

describe("validateIssueDescription", () => {
  test("accepts empty description", () => {
    expect(() => validateIssueDescription("")).not.toThrow();
  });

  test("accepts description at 50,000 characters", () => {
    expect(() => validateIssueDescription("a".repeat(50000))).not.toThrow();
  });

  test("rejects description over 50,000 characters", () => {
    expect(() => validateIssueDescription("a".repeat(50001))).toThrow(
      "Description must be 50,000 characters or fewer"
    );
  });
});

describe("validateCommentBody", () => {
  test("accepts empty comment body", () => {
    expect(() => validateCommentBody("")).not.toThrow();
  });

  test("accepts body at 50,000 characters", () => {
    expect(() => validateCommentBody("a".repeat(50000))).not.toThrow();
  });

  test("rejects body over 50,000 characters", () => {
    expect(() => validateCommentBody("a".repeat(50001))).toThrow(
      "Comment body must be 50,000 characters or fewer"
    );
  });
});
