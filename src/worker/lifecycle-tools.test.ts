import { describe, test, expect } from "bun:test";
import { READ_ONLY_TOOLS, PLANNING_TOOLS, PLANNING_RESEARCH_TOOLS, CODING_TOOLS, REVIEW_TOOLS } from "./mcp-tools";

describe("MCP tool lists by phase", () => {
  test("READ_ONLY_TOOLS contains only read operations", () => {
    for (const tool of READ_ONLY_TOOLS) {
      expect(tool).toMatch(/^mcp__yes-kanban__(get_|list_)/);
    }
  });

  test("READ_ONLY_TOOLS contains all expected tools", () => {
    const expected = [
      "mcp__yes-kanban__get_feedback",
      "mcp__yes-kanban__get_current_issue",
      "mcp__yes-kanban__get_project_columns",
      "mcp__yes-kanban__get_workspace_info",
      "mcp__yes-kanban__list_issues",
      "mcp__yes-kanban__get_issue",
      "mcp__yes-kanban__list_attachments",
      "mcp__yes-kanban__list_comments",
    ];
    for (const tool of expected) {
      expect(READ_ONLY_TOOLS).toContain(tool);
    }
    expect(READ_ONLY_TOOLS).toHaveLength(expected.length);
  });

  test("PLANNING_TOOLS includes all read-only tools", () => {
    for (const tool of READ_ONLY_TOOLS) {
      expect(PLANNING_TOOLS).toContain(tool);
    }
  });

  test("PLANNING_TOOLS includes submit_plan and ask_question", () => {
    expect(PLANNING_TOOLS).toContain("mcp__yes-kanban__submit_plan");
    expect(PLANNING_TOOLS).toContain("mcp__yes-kanban__ask_question");
    expect(PLANNING_TOOLS).toContain("mcp__yes-kanban__get_plan");
  });

  test("PLANNING_RESEARCH_TOOLS includes all planning tools plus web tools", () => {
    for (const tool of PLANNING_TOOLS) {
      expect(PLANNING_RESEARCH_TOOLS).toContain(tool);
    }
    expect(PLANNING_RESEARCH_TOOLS).toContain("WebSearch");
    expect(PLANNING_RESEARCH_TOOLS).toContain("WebFetch");
  });

  test("CODING_TOOLS includes all read-only tools", () => {
    for (const tool of READ_ONLY_TOOLS) {
      expect(CODING_TOOLS).toContain(tool);
    }
  });

  test("CODING_TOOLS includes issue management tools for kanban access", () => {
    expect(CODING_TOOLS).toContain("mcp__yes-kanban__create_issue");
    expect(CODING_TOOLS).toContain("mcp__yes-kanban__update_issue");
    expect(CODING_TOOLS).toContain("mcp__yes-kanban__add_blocker");
    expect(CODING_TOOLS).toContain("mcp__yes-kanban__remove_blocker");
  });

  test("CODING_TOOLS includes comment and question tools", () => {
    expect(CODING_TOOLS).toContain("mcp__yes-kanban__add_comment");
    expect(CODING_TOOLS).toContain("mcp__yes-kanban__ask_question");
  });

  test("CODING_TOOLS includes get_plan for referencing approved plan", () => {
    expect(CODING_TOOLS).toContain("mcp__yes-kanban__get_plan");
  });

  test("CODING_TOOLS does not include destructive tools", () => {
    expect(CODING_TOOLS).not.toContain("mcp__yes-kanban__delete_issue");
    expect(CODING_TOOLS).not.toContain("mcp__yes-kanban__move_issue");
  });

  test("REVIEW_TOOLS is read-only only", () => {
    expect(REVIEW_TOOLS).toEqual(READ_ONLY_TOOLS);
  });

  test("no duplicate entries in any tool list", () => {
    for (const [, tools] of [
      ["READ_ONLY_TOOLS", READ_ONLY_TOOLS],
      ["PLANNING_TOOLS", PLANNING_TOOLS],
      ["PLANNING_RESEARCH_TOOLS", PLANNING_RESEARCH_TOOLS],
      ["CODING_TOOLS", CODING_TOOLS],
      ["REVIEW_TOOLS", REVIEW_TOOLS],
    ] as const) {
      const unique = new Set(tools);
      expect(unique.size).toBe(tools.length);
    }
  });
});
