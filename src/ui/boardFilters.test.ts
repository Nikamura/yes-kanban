import { describe, it, expect } from "bun:test";
import { filterIssues, sortIssues } from "./boardFilters";

// Minimal issue factory for testing
function makeIssue(overrides: Record<string, any> = {}) {
  return {
    _id: overrides["_id"] ?? "id1",
    _creationTime: 0,
    simpleId: overrides["simpleId"] ?? "P-1",
    title: overrides["title"] ?? "Test issue",
    description: overrides["description"] ?? "",
    status: overrides["status"] ?? "To Do",
    priority: "priority" in overrides ? overrides["priority"] : "medium",
    tags: overrides["tags"] ?? [],
    dueDate: "dueDate" in overrides ? overrides["dueDate"] : undefined,
    position: overrides["position"] ?? 0,
    createdAt: overrides["createdAt"] ?? 1000,
    updatedAt: overrides["updatedAt"] ?? 2000,
    projectId: "proj1",
    assignee: null,
    storyPoints: null,
  } as any;
}

describe("filterIssues", () => {
  const issues = [
    makeIssue({ _id: "a", title: "Fix login bug", simpleId: "P-1", priority: "urgent" }),
    makeIssue({ _id: "b", title: "Add dashboard", simpleId: "P-2", priority: "high" }),
    makeIssue({ _id: "c", title: "Update docs", simpleId: "P-3", priority: "low" }),
  ];

  it("returns all issues when no filters set", () => {
    const result = filterIssues(issues, { search: "", filterPriority: "" });
    expect(result).toHaveLength(3);
  });

  it("filters by priority", () => {
    const result = filterIssues(issues, { search: "", filterPriority: "urgent" });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("a");
  });

  it("filters by search on title", () => {
    const result = filterIssues(issues, { search: "dashboard", filterPriority: "" });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("b");
  });

  it("filters by search on simpleId", () => {
    const result = filterIssues(issues, { search: "P-3", filterPriority: "" });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("c");
  });

  it("search is case-insensitive", () => {
    const result = filterIssues(issues, { search: "FIX LOGIN", filterPriority: "" });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("a");
  });

  it("combines search and priority filters", () => {
    const result = filterIssues(issues, { search: "fix", filterPriority: "low" });
    expect(result).toHaveLength(0);
  });

  it("filters by status", () => {
    const statusIssues = [
      makeIssue({ _id: "a", status: "To Do" }),
      makeIssue({ _id: "b", status: "In Progress" }),
      makeIssue({ _id: "c", status: "To Do" }),
    ];
    const result = filterIssues(statusIssues, { search: "", filterPriority: "", filterStatus: "In Progress" });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("b");
  });

  it("searches description when searchDescription is true", () => {
    const descIssues = [
      makeIssue({ _id: "a", title: "Issue A", description: "contains the keyword" }),
      makeIssue({ _id: "b", title: "Issue B", description: "nothing here" }),
    ];
    const result = filterIssues(descIssues, { search: "keyword", filterPriority: "", searchDescription: true });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("a");
  });

  it("does not search description when searchDescription is false", () => {
    const descIssues = [
      makeIssue({ _id: "a", title: "Issue A", description: "contains the keyword" }),
    ];
    const result = filterIssues(descIssues, { search: "keyword", filterPriority: "" });
    expect(result).toHaveLength(0);
  });

  it("filters by workspace status", () => {
    const wsStatuses = { a: { status: "coding" }, b: { status: "testing" }, c: { status: "completed" } };
    const result = filterIssues(issues, {
      search: "",
      filterPriority: "",
      filterWorkspaceStatuses: new Set(["coding"]),
      workspaceStatuses: wsStatuses,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("a");
  });

  it("filters by multiple workspace statuses", () => {
    const wsStatuses = { a: { status: "coding" }, b: { status: "testing" }, c: { status: "completed" } };
    const result = filterIssues(issues, {
      search: "",
      filterPriority: "",
      filterWorkspaceStatuses: new Set(["coding", "testing"]),
      workspaceStatuses: wsStatuses,
    });
    expect(result).toHaveLength(2);
  });

  it("excludes issues without workspace when workspace filter is active", () => {
    const wsStatuses = { a: { status: "coding" } };
    const result = filterIssues(issues, {
      search: "",
      filterPriority: "",
      filterWorkspaceStatuses: new Set(["coding"]),
      workspaceStatuses: wsStatuses,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!._id as string).toBe("a");
  });

  it("returns all issues when workspace filter set is empty", () => {
    const wsStatuses = { a: { status: "coding" } };
    const result = filterIssues(issues, {
      search: "",
      filterPriority: "",
      filterWorkspaceStatuses: new Set(),
      workspaceStatuses: wsStatuses,
    });
    expect(result).toHaveLength(3);
  });
});

describe("sortIssues", () => {
  it("sorts by position", () => {
    const issues = [
      makeIssue({ position: 3 }),
      makeIssue({ position: 1 }),
      makeIssue({ position: 2 }),
    ];
    issues.sort(sortIssues("position"));
    expect(issues.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it("sorts by priority (urgent first)", () => {
    const issues = [
      makeIssue({ priority: "low" }),
      makeIssue({ priority: "urgent" }),
      makeIssue({ priority: "high" }),
    ];
    issues.sort(sortIssues("priority"));
    expect(issues.map((i) => i.priority)).toEqual(["urgent", "high", "low"]);
  });

  it("sorts by createdAt", () => {
    const issues = [
      makeIssue({ createdAt: 3000 }),
      makeIssue({ createdAt: 1000 }),
      makeIssue({ createdAt: 2000 }),
    ];
    issues.sort(sortIssues("createdAt"));
    expect(issues.map((i) => i.createdAt)).toEqual([1000, 2000, 3000]);
  });

  it("sorts by updatedAt", () => {
    const issues = [
      makeIssue({ updatedAt: 5000 }),
      makeIssue({ updatedAt: 1000 }),
      makeIssue({ updatedAt: 3000 }),
    ];
    issues.sort(sortIssues("updatedAt"));
    expect(issues.map((i) => i.updatedAt)).toEqual([1000, 3000, 5000]);
  });

  it("puts issues without priority last when sorting by priority", () => {
    const issues = [
      makeIssue({ priority: undefined }),
      makeIssue({ priority: "high" }),
    ];
    issues.sort(sortIssues("priority"));
    expect(issues[0].priority).toBe("high");
    expect(issues[1].priority).toBeUndefined();
  });

  it("sorts by simpleId", () => {
    const issues = [
      makeIssue({ simpleId: "P-3" }),
      makeIssue({ simpleId: "P-1" }),
      makeIssue({ simpleId: "P-2" }),
    ];
    issues.sort(sortIssues("simpleId"));
    expect(issues.map((i) => i.simpleId)).toEqual(["P-1", "P-2", "P-3"]);
  });

  it("sorts by title", () => {
    const issues = [
      makeIssue({ title: "Charlie" }),
      makeIssue({ title: "Alpha" }),
      makeIssue({ title: "Bravo" }),
    ];
    issues.sort(sortIssues("title"));
    expect(issues.map((i) => i.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("sorts by status", () => {
    const issues = [
      makeIssue({ status: "To Do" }),
      makeIssue({ status: "Done" }),
      makeIssue({ status: "In Progress" }),
    ];
    issues.sort(sortIssues("status"));
    expect(issues.map((i) => i.status)).toEqual(["Done", "In Progress", "To Do"]);
  });

  it("sorts descending when ascending is false", () => {
    const issues = [
      makeIssue({ position: 1 }),
      makeIssue({ position: 3 }),
      makeIssue({ position: 2 }),
    ];
    issues.sort(sortIssues("position", false));
    expect(issues.map((i) => i.position)).toEqual([3, 2, 1]);
  });

  it("sorts by dueDate with nulls last", () => {
    const issues = [
      makeIssue({ dueDate: undefined }),
      makeIssue({ dueDate: 3000 }),
      makeIssue({ dueDate: 1000 }),
    ];
    issues.sort(sortIssues("dueDate"));
    expect(issues.map((i) => i.dueDate)).toEqual([1000, 3000, undefined]);
  });
});
