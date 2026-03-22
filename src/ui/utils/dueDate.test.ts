import { describe, it, expect } from "bun:test";
import { getDueDateInfo, dateToTimestamp, timestampToDateStr } from "./dueDate";

describe("getDueDateInfo", () => {
  it("returns overdue for past dates", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    yesterday.setHours(0, 0, 0, 0);
    const info = getDueDateInfo(yesterday.getTime());
    expect(info.className).toBe("due-overdue");
    expect(info.label).toContain("Overdue");
  });

  it("returns due-today for today", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const info = getDueDateInfo(today.getTime());
    expect(info.className).toBe("due-today");
    expect(info.label).toBe("Due today");
  });

  it("returns due-soon for dates within a week", () => {
    const threeDays = new Date();
    threeDays.setDate(threeDays.getDate() + 3);
    threeDays.setHours(0, 0, 0, 0);
    const info = getDueDateInfo(threeDays.getTime());
    expect(info.className).toBe("due-soon");
    expect(info.label).toContain("Due");
  });

  it("returns due-future for dates beyond a week", () => {
    const twoWeeks = new Date();
    twoWeeks.setDate(twoWeeks.getDate() + 14);
    twoWeeks.setHours(0, 0, 0, 0);
    const info = getDueDateInfo(twoWeeks.getTime());
    expect(info.className).toBe("due-future");
    expect(info.label).toContain("Due");
  });
});

describe("dateToTimestamp", () => {
  it("converts a date string to a timestamp at midnight", () => {
    const ts = dateToTimestamp("2025-06-15");
    expect(ts).toBeDefined();
    const date = new Date(ts!);
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(5); // June is 0-indexed
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
  });

  it("returns undefined for empty string", () => {
    expect(dateToTimestamp("")).toBeUndefined();
  });

  it("returns undefined for invalid date", () => {
    expect(dateToTimestamp("not-a-date")).toBeUndefined();
  });
});

describe("timestampToDateStr", () => {
  it("converts a timestamp to YYYY-MM-DD format", () => {
    const date = new Date(2025, 5, 15); // June 15, 2025
    const str = timestampToDateStr(date.getTime());
    expect(str).toBe("2025-06-15");
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2025, 0, 5); // Jan 5
    const str = timestampToDateStr(date.getTime());
    expect(str).toBe("2025-01-05");
  });
});
