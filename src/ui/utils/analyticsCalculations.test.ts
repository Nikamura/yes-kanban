import { describe, it, expect } from "bun:test";
import {
  weekKey, monthKey, parseHistoryValue, isStatusChange,
  getCompletionColumnName, getTerminalColumnNames,
  computeCycleTime, computeThroughput,
  computeCreatedVsCompleted, computeSummary,
  computeCumulativeFlow, computeAvgTimePerColumn,
  type HistoryEntry, type ColumnDef,
} from "./analyticsCalculations";

const DAY_MS = 24 * 60 * 60 * 1000;

const COLUMNS: ColumnDef[] = [
  { name: "Backlog", color: "#888", position: 0 },
  { name: "In Progress", color: "#3b82f6", position: 1 },
  { name: "Review", color: "#f59e0b", position: 2 },
  { name: "Done", color: "#10b981", position: 3 },
  { name: "Cancelled", color: "#ef4444", position: 4 },
];

// Monday 2026-01-05 00:00 UTC
const BASE_TS = new Date("2026-01-05T00:00:00Z").getTime();

function makeStatusChange(issueId: string, newValue: string, daysAfterBase: number, oldValue?: string): HistoryEntry {
  return {
    issueId,
    action: "updated",
    field: "status",
    oldValue: oldValue ? JSON.stringify(oldValue) : undefined,
    newValue: JSON.stringify(newValue),
    timestamp: BASE_TS + daysAfterBase * DAY_MS,
  };
}

function makeMove(issueId: string, newValue: string, daysAfterBase: number, oldValue?: string): HistoryEntry {
  return {
    issueId,
    action: "moved",
    field: "status",
    oldValue: oldValue ? JSON.stringify(oldValue) : undefined,
    newValue: JSON.stringify(newValue),
    timestamp: BASE_TS + daysAfterBase * DAY_MS,
  };
}

function makeCreated(issueId: string, daysAfterBase: number): HistoryEntry {
  return {
    issueId,
    action: "created",
    field: "issue",
    timestamp: BASE_TS + daysAfterBase * DAY_MS,
  };
}

describe("weekKey", () => {
  it("returns Monday for a Wednesday timestamp", () => {
    // 2026-01-07 is a Wednesday, Monday is 2026-01-05
    const ts = new Date("2026-01-07T12:00:00Z").getTime();
    expect(weekKey(ts)).toBe("2026-01-05");
  });

  it("returns same Monday for a Monday timestamp", () => {
    const ts = new Date("2026-01-05T00:00:00Z").getTime();
    expect(weekKey(ts)).toBe("2026-01-05");
  });

  it("returns previous Monday for a Sunday timestamp", () => {
    // 2026-01-11 is a Sunday, Monday is 2026-01-05
    const ts = new Date("2026-01-11T23:59:59Z").getTime();
    expect(weekKey(ts)).toBe("2026-01-05");
  });
});

describe("monthKey", () => {
  it("returns YYYY-MM format", () => {
    const ts = new Date("2026-03-15T00:00:00Z").getTime();
    expect(monthKey(ts)).toBe("2026-03");
  });

  it("zero-pads single-digit months", () => {
    const ts = new Date("2026-01-01T00:00:00Z").getTime();
    expect(monthKey(ts)).toBe("2026-01");
  });
});

describe("parseHistoryValue", () => {
  it("parses JSON-wrapped strings", () => {
    expect(parseHistoryValue(JSON.stringify("In Progress"))).toBe("In Progress");
  });

  it("returns raw value for non-JSON", () => {
    expect(parseHistoryValue("plain text")).toBe("plain text");
  });

  it("returns raw value for JSON non-string", () => {
    expect(parseHistoryValue(JSON.stringify(42))).toBe("42");
  });

  it("returns empty string for undefined", () => {
    expect(parseHistoryValue(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(parseHistoryValue("")).toBe("");
  });
});

describe("isStatusChange", () => {
  it("returns true for moved + status", () => {
    expect(isStatusChange({ issueId: "x", action: "moved", field: "status", timestamp: 0 })).toBe(true);
  });

  it("returns true for updated + status", () => {
    expect(isStatusChange({ issueId: "x", action: "updated", field: "status", timestamp: 0 })).toBe(true);
  });

  it("returns false for created action", () => {
    expect(isStatusChange({ issueId: "x", action: "created", field: "issue", timestamp: 0 })).toBe(false);
  });

  it("returns false for updated + non-status field", () => {
    expect(isStatusChange({ issueId: "x", action: "updated", field: "priority", timestamp: 0 })).toBe(false);
  });

  it("returns false for moved + non-status field", () => {
    expect(isStatusChange({ issueId: "x", action: "moved", field: "priority", timestamp: 0 })).toBe(false);
  });
});

describe("getCompletionColumnName", () => {
  it("returns second-to-last column for standard 5-column setup", () => {
    expect(getCompletionColumnName(COLUMNS)).toBe("Done");
  });

  it("returns empty string for no columns", () => {
    expect(getCompletionColumnName([])).toBe("");
  });

  it("returns single column name when only one column exists", () => {
    expect(getCompletionColumnName([{ name: "Todo", color: "#fff", position: 0 }])).toBe("Todo");
  });

  it("returns last column for 2-column board", () => {
    const twoColumns: ColumnDef[] = [
      { name: "Todo", color: "#888", position: 0 },
      { name: "Done", color: "#10b981", position: 1 },
    ];
    expect(getCompletionColumnName(twoColumns)).toBe("Done");
  });

  it("works with custom column names (3+ columns)", () => {
    const customColumns: ColumnDef[] = [
      { name: "Backlog", color: "#888", position: 0 },
      { name: "Working", color: "#3b82f6", position: 1 },
      { name: "Shipped", color: "#10b981", position: 2 },
      { name: "Archived", color: "#ef4444", position: 3 },
    ];
    expect(getCompletionColumnName(customColumns)).toBe("Shipped");
  });
});

describe("getTerminalColumnNames", () => {
  it("returns last two columns for 3+ column setup", () => {
    const terminal = getTerminalColumnNames(COLUMNS);
    expect(terminal.has("Done")).toBe(true);
    expect(terminal.has("Cancelled")).toBe(true);
    expect(terminal.size).toBe(2);
  });

  it("returns only last column for 2-column board", () => {
    const twoColumns: ColumnDef[] = [
      { name: "Todo", color: "#888", position: 0 },
      { name: "Done", color: "#10b981", position: 1 },
    ];
    const terminal = getTerminalColumnNames(twoColumns);
    expect(terminal.has("Done")).toBe(true);
    expect(terminal.has("Todo")).toBe(false);
    expect(terminal.size).toBe(1);
  });

  it("returns single column when only one exists", () => {
    const terminal = getTerminalColumnNames([{ name: "Todo", color: "#fff", position: 0 }]);
    expect(terminal.has("Todo")).toBe(true);
    expect(terminal.size).toBe(1);
  });

  it("returns empty set for no columns", () => {
    const terminal = getTerminalColumnNames([]);
    expect(terminal.size).toBe(0);
  });
});

describe("computeCycleTime", () => {
  it("returns zero for empty history", () => {
    const result = computeCycleTime([], COLUMNS);
    expect(result.average).toBe(0);
    expect(result.trend).toEqual([]);
  });

  it("calculates cycle time for a single issue", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 1, "Backlog"),
      makeStatusChange("issue1", "Review", 3, "In Progress"),
      makeStatusChange("issue1", "Done", 5, "Review"),
    ];
    const result = computeCycleTime(history, COLUMNS);
    // 5 days - 1 day = 4 days from In Progress to Done
    expect(result.average).toBe(4);
  });

  it("calculates average cycle time for multiple issues", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 1),
      makeStatusChange("issue1", "Done", 3), // 2 days
      makeCreated("issue2", 0),
      makeStatusChange("issue2", "In Progress", 2),
      makeStatusChange("issue2", "Done", 8), // 6 days
    ];
    const result = computeCycleTime(history, COLUMNS);
    // Average: (2 + 6) / 2 = 4 days
    expect(result.average).toBe(4);
  });

  it("ignores issues that never reach completion", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 1),
      // Never moved to Done
    ];
    const result = computeCycleTime(history, COLUMNS);
    expect(result.average).toBe(0);
  });

  it("works with custom completion column names", () => {
    const customColumns: ColumnDef[] = [
      { name: "Backlog", color: "#888", position: 0 },
      { name: "Working", color: "#3b82f6", position: 1 },
      { name: "Shipped", color: "#10b981", position: 2 },
      { name: "Archived", color: "#ef4444", position: 3 },
    ];
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "Working", 1),
      makeStatusChange("issue1", "Shipped", 4),
    ];
    const result = computeCycleTime(history, customColumns);
    expect(result.average).toBe(3);
  });

  it("handles 'moved' action entries (real column moves)", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeMove("issue1", "In Progress", 1, "Backlog"),
      makeMove("issue1", "Done", 4, "In Progress"),
    ];
    const result = computeCycleTime(history, COLUMNS);
    expect(result.average).toBe(3);
  });

  it("handles mixed 'moved' and 'updated' actions", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeMove("issue1", "In Progress", 1),          // moved via drag
      makeStatusChange("issue1", "Review", 3),        // updated via inline edit
      makeMove("issue1", "Done", 5),                  // moved via drag
    ];
    const result = computeCycleTime(history, COLUMNS);
    expect(result.average).toBe(4);
  });

  it("uses first-start-to-last-completion for reopened issues", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 1),
      makeStatusChange("issue1", "Done", 3),        // first completion: 2 days
      makeStatusChange("issue1", "In Progress", 4), // reopened
      makeStatusChange("issue1", "Done", 7),         // re-completed
    ];
    const result = computeCycleTime(history, COLUMNS);
    // Cycle time should be from first work (day 1) to last completion (day 7) = 6 days
    expect(result.average).toBe(6);
  });

  it("groups trend by week", () => {
    const history: HistoryEntry[] = [
      // Week 1
      makeStatusChange("issue1", "In Progress", 0),
      makeStatusChange("issue1", "Done", 2),
      // Week 2
      makeStatusChange("issue2", "In Progress", 7),
      makeStatusChange("issue2", "Done", 10),
    ];
    const result = computeCycleTime(history, COLUMNS);
    expect(result.trend.length).toBe(2);
    expect(result.trend[0]?.avgDays).toBe(2);
    expect(result.trend[1]?.avgDays).toBe(3);
  });
});

describe("computeThroughput", () => {
  it("returns empty for empty history", () => {
    const result = computeThroughput([], COLUMNS);
    expect(result.weekly).toEqual([]);
    expect(result.monthly).toEqual([]);
  });

  it("counts completed items per week", () => {
    const history: HistoryEntry[] = [
      makeStatusChange("issue1", "Done", 0),
      makeStatusChange("issue2", "Done", 1),
      makeStatusChange("issue3", "Done", 8), // next week
    ];
    const result = computeThroughput(history, COLUMNS);
    expect(result.weekly.length).toBe(2);
    expect(result.weekly[0]?.count).toBe(2);
    expect(result.weekly[1]?.count).toBe(1);
  });

  it("counts completed items per month", () => {
    const history: HistoryEntry[] = [
      makeStatusChange("issue1", "Done", 0),
      makeStatusChange("issue2", "Done", 35), // next month
    ];
    const result = computeThroughput(history, COLUMNS);
    expect(result.monthly.length).toBe(2);
  });

  it("counts 'moved' action completions", () => {
    const history: HistoryEntry[] = [
      makeMove("issue1", "Done", 0),
      makeMove("issue2", "Done", 1),
    ];
    const result = computeThroughput(history, COLUMNS);
    expect(result.weekly[0]?.count).toBe(2);
  });

  it("ignores non-completion status changes", () => {
    const history: HistoryEntry[] = [
      makeStatusChange("issue1", "In Progress", 0),
      makeStatusChange("issue1", "Review", 2),
      makeStatusChange("issue2", "Cancelled", 3),
    ];
    const result = computeThroughput(history, COLUMNS);
    expect(result.weekly).toEqual([]);
  });

  it("does not double-count reopened issues", () => {
    const history: HistoryEntry[] = [
      makeStatusChange("issue1", "Done", 0),       // first completion
      makeStatusChange("issue1", "In Progress", 2), // reopened
      makeStatusChange("issue1", "Done", 5),        // re-completed
    ];
    const result = computeThroughput(history, COLUMNS);
    // Should count issue1 only once, in the week of the last completion
    const totalCount = result.weekly.reduce((sum, w) => sum + w.count, 0);
    expect(totalCount).toBe(1);
  });
});

describe("computeCreatedVsCompleted", () => {
  it("returns empty for empty history", () => {
    expect(computeCreatedVsCompleted([], COLUMNS)).toEqual([]);
  });

  it("tracks created and completed per week", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeCreated("issue2", 1),
      makeStatusChange("issue1", "Done", 3),
    ];
    const result = computeCreatedVsCompleted(history, COLUMNS);
    expect(result.length).toBe(1); // all in same week
    expect(result[0]?.created).toBe(2);
    expect(result[0]?.completed).toBe(1);
  });

  it("counts 'moved' action completions", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeMove("issue1", "Done", 3),
    ];
    const result = computeCreatedVsCompleted(history, COLUMNS);
    expect(result[0]?.created).toBe(1);
    expect(result[0]?.completed).toBe(1);
  });

  it("separates weeks correctly", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),    // week 1
      makeCreated("issue2", 8),    // week 2
      makeStatusChange("issue1", "Done", 9), // week 2
    ];
    const result = computeCreatedVsCompleted(history, COLUMNS);
    expect(result.length).toBe(2);
    expect(result[0]?.created).toBe(1);
    expect(result[0]?.completed).toBe(0);
    expect(result[1]?.created).toBe(1);
    expect(result[1]?.completed).toBe(1);
  });

  it("does not double-count reopened issues", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "Done", 2),        // first completion
      makeStatusChange("issue1", "In Progress", 3),  // reopened
      makeStatusChange("issue1", "Done", 5),         // re-completed
    ];
    const result = computeCreatedVsCompleted(history, COLUMNS);
    const totalCompleted = result.reduce((sum, w) => sum + w.completed, 0);
    expect(totalCompleted).toBe(1);
  });
});

describe("computeSummary", () => {
  it("returns zeros for empty history", () => {
    const result = computeSummary([], COLUMNS, 0, undefined, BASE_TS);
    expect(result.totalCreated).toBe(0);
    expect(result.totalCompleted).toBe(0);
    expect(result.throughputPerWeek).toBe(0);
  });

  it("counts totals correctly", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeCreated("issue2", 1),
      makeCreated("issue3", 2),
      makeStatusChange("issue1", "Done", 5),
      makeStatusChange("issue2", "Done", 10),
    ];
    const endTime = BASE_TS + 14 * DAY_MS; // 2 weeks
    const result = computeSummary(history, COLUMNS, 3.5, BASE_TS, endTime);
    expect(result.totalCreated).toBe(3);
    expect(result.totalCompleted).toBe(2);
    expect(result.avgCycleTime).toBe(3.5);
    expect(result.throughputPerWeek).toBe(1);
  });

  it("uses first history entry as start when startTime is undefined", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "Done", 7),
    ];
    const endTime = BASE_TS + 7 * DAY_MS;
    const result = computeSummary(history, COLUMNS, 7, undefined, endTime);
    expect(result.throughputPerWeek).toBe(1);
  });

  it("does not double-count reopened issues in totalCompleted", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "Done", 2),
      makeStatusChange("issue1", "In Progress", 3),
      makeStatusChange("issue1", "Done", 5),
    ];
    const endTime = BASE_TS + 7 * DAY_MS;
    const result = computeSummary(history, COLUMNS, 5, BASE_TS, endTime);
    expect(result.totalCompleted).toBe(1);
  });
});

describe("computeCumulativeFlow", () => {
  it("returns empty for empty history", () => {
    expect(computeCumulativeFlow([], COLUMNS, BASE_TS)).toEqual([]);
  });

  it("returns empty for empty columns", () => {
    const history: HistoryEntry[] = [makeCreated("issue1", 0)];
    expect(computeCumulativeFlow(history, [], BASE_TS)).toEqual([]);
  });

  it("tracks issue creation in first column", () => {
    const history: HistoryEntry[] = [makeCreated("issue1", 0)];
    const endTime = BASE_TS + DAY_MS;
    const result = computeCumulativeFlow(history, COLUMNS, endTime);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.["Backlog"]).toBe(1);
    expect(result[0]?.["In Progress"]).toBe(0);
    expect(result[0]?.["Done"]).toBe(0);
  });

  it("tracks status changes across days", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 1),
      makeStatusChange("issue1", "Done", 2),
    ];
    const endTime = BASE_TS + 3 * DAY_MS;
    const result = computeCumulativeFlow(history, COLUMNS, endTime);
    // Day 0: Backlog=1
    expect(result[0]?.["Backlog"]).toBe(1);
    // Day 1: In Progress=1
    expect(result[1]?.["In Progress"]).toBe(1);
    expect(result[1]?.["Backlog"]).toBe(0);
    // Day 2: Done=1
    expect(result[2]?.["Done"]).toBe(1);
    expect(result[2]?.["In Progress"]).toBe(0);
  });

  it("tracks multiple issues", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeCreated("issue2", 0),
      makeStatusChange("issue1", "In Progress", 1),
    ];
    const endTime = BASE_TS + 2 * DAY_MS;
    const result = computeCumulativeFlow(history, COLUMNS, endTime);
    // Day 1: issue1 in In Progress, issue2 still in Backlog
    expect(result[1]?.["Backlog"]).toBe(1);
    expect(result[1]?.["In Progress"]).toBe(1);
  });

  it("handles 'moved' actions", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeMove("issue1", "In Progress", 1),
    ];
    const endTime = BASE_TS + 2 * DAY_MS;
    const result = computeCumulativeFlow(history, COLUMNS, endTime);
    expect(result[1]?.["In Progress"]).toBe(1);
  });

  it("downsamples when range exceeds 365 days", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 200),
      makeStatusChange("issue1", "Done", 500),
    ];
    const endTime = BASE_TS + 730 * DAY_MS; // 2 years
    const result = computeCumulativeFlow(history, COLUMNS, endTime);
    // Should be capped at ~365 data points, not 731
    expect(result.length).toBeLessThanOrEqual(366);
    expect(result.length).toBeGreaterThan(0);
    // Last snapshot should reflect final state (issue in Done)
    const last = result[result.length - 1];
    expect(last?.["Done"]).toBe(1);
  });
});

describe("computeAvgTimePerColumn", () => {
  it("returns empty for empty history", () => {
    expect(computeAvgTimePerColumn([], COLUMNS, BASE_TS)).toEqual([]);
  });

  it("returns empty for empty columns", () => {
    const history: HistoryEntry[] = [makeCreated("issue1", 0)];
    expect(computeAvgTimePerColumn(history, [], BASE_TS)).toEqual([]);
  });

  it("calculates time spent in non-terminal columns", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 2),
      makeStatusChange("issue1", "Review", 5),
      makeStatusChange("issue1", "Done", 7),
    ];
    const endTime = BASE_TS + 10 * DAY_MS;
    const result = computeAvgTimePerColumn(history, COLUMNS, endTime);
    const backlog = result.find((r) => r.column === "Backlog");
    const inProgress = result.find((r) => r.column === "In Progress");
    const review = result.find((r) => r.column === "Review");
    const done = result.find((r) => r.column === "Done");
    // Backlog: 2 days, In Progress: 3 days, Review: 2 days
    expect(backlog?.avgDays).toBe(2);
    expect(inProgress?.avgDays).toBe(3);
    expect(review?.avgDays).toBe(2);
    // Terminal columns should be 0
    expect(done?.avgDays).toBe(0);
  });

  it("averages across multiple issues", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 1),
      makeStatusChange("issue1", "Done", 5), // 4 days in In Progress
      makeCreated("issue2", 0),
      makeStatusChange("issue2", "In Progress", 2),
      makeStatusChange("issue2", "Done", 4), // 2 days in In Progress
    ];
    const endTime = BASE_TS + 10 * DAY_MS;
    const result = computeAvgTimePerColumn(history, COLUMNS, endTime);
    const inProgress = result.find((r) => r.column === "In Progress");
    // Average: (4 + 2) / 2 = 3 days
    expect(inProgress?.avgDays).toBe(3);
  });

  it("uses endTime for issues still in a column", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeStatusChange("issue1", "In Progress", 2),
      // Never moved out of In Progress
    ];
    const endTime = BASE_TS + 12 * DAY_MS;
    const result = computeAvgTimePerColumn(history, COLUMNS, endTime);
    const inProgress = result.find((r) => r.column === "In Progress");
    // 12 - 2 = 10 days
    expect(inProgress?.avgDays).toBe(10);
  });

  it("handles 'moved' actions", () => {
    const history: HistoryEntry[] = [
      makeCreated("issue1", 0),
      makeMove("issue1", "In Progress", 1),
      makeMove("issue1", "Done", 4),
    ];
    const endTime = BASE_TS + 5 * DAY_MS;
    const result = computeAvgTimePerColumn(history, COLUMNS, endTime);
    const inProgress = result.find((r) => r.column === "In Progress");
    expect(inProgress?.avgDays).toBe(3);
  });
});
