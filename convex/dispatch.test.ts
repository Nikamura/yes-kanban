import { describe, test, expect } from "bun:test";
import { isBlockedByUnresolved } from "./dispatch";

describe("isBlockedByUnresolved", () => {
  test("empty blocker list is not blocked", () => {
    expect(isBlockedByUnresolved([])).toBe(false);
  });

  test("all blockers in Done is not blocked", () => {
    expect(isBlockedByUnresolved([{ status: "Done" }, { status: "Done" }])).toBe(false);
  });

  test("legacy Cancelled status is still treated as non-terminal until migrated", () => {
    expect(isBlockedByUnresolved([{ status: "Cancelled" }, { status: "Done" }])).toBe(true);
  });

  test("blocker in In Progress IS blocked", () => {
    expect(isBlockedByUnresolved([{ status: "Done" }, { status: "In Progress" }])).toBe(true);
  });

  test("blocker in Backlog IS blocked", () => {
    expect(isBlockedByUnresolved([{ status: "Backlog" }])).toBe(true);
  });

  test("deleted blocker (null) is treated as resolved", () => {
    expect(isBlockedByUnresolved([null])).toBe(false);
  });

  test("mix of deleted and unresolved blockers IS blocked", () => {
    expect(isBlockedByUnresolved([null, { status: "In Progress" }])).toBe(true);
  });
});
