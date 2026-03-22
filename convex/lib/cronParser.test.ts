import { describe, expect, test } from "bun:test";
import { validateCron, getNextOccurrence, describeCron } from "./cronParser";

describe("validateCron", () => {
  test("accepts valid expressions", () => {
    expect(validateCron("0 9 * * *")).toBeNull();
    expect(validateCron("*/15 * * * *")).toBeNull();
    expect(validateCron("0 9 * * 1")).toBeNull();
    expect(validateCron("0 9 1 * *")).toBeNull();
    expect(validateCron("30 14 1,15 * *")).toBeNull();
    expect(validateCron("0 0 * * 1-5")).toBeNull();
  });

  test("rejects wrong number of fields", () => {
    expect(validateCron("0 9 *")).not.toBeNull();
    expect(validateCron("0 9 * * * *")).not.toBeNull();
    expect(validateCron("")).not.toBeNull();
  });

  test("rejects out-of-range values", () => {
    expect(validateCron("60 * * * *")).not.toBeNull();
    expect(validateCron("* 24 * * *")).not.toBeNull();
    expect(validateCron("* * 32 * *")).not.toBeNull();
    expect(validateCron("* * * 13 *")).not.toBeNull();
    expect(validateCron("* * * * 7")).not.toBeNull();
  });

  test("rejects invalid ranges", () => {
    expect(validateCron("5-2 * * * *")).not.toBeNull();
  });

  test("accepts steps", () => {
    expect(validateCron("*/5 * * * *")).toBeNull();
    expect(validateCron("0-30/10 * * * *")).toBeNull();
  });

  test("accepts lists", () => {
    expect(validateCron("0,15,30,45 * * * *")).toBeNull();
  });
});

describe("getNextOccurrence", () => {
  test("daily at 9:00 UTC", () => {
    // 2026-03-20 08:00 UTC
    const after = Date.UTC(2026, 2, 20, 8, 0, 0);
    const next = getNextOccurrence("0 9 * * *", after);
    const d = new Date(next);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCDate()).toBe(20);
    expect(d.getUTCMonth()).toBe(2); // March
  });

  test("daily at 9:00 UTC, after 9:00 returns next day", () => {
    const after = Date.UTC(2026, 2, 20, 9, 30, 0);
    const next = getNextOccurrence("0 9 * * *", after);
    const d = new Date(next);
    expect(d.getUTCDate()).toBe(21);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBe(0);
  });

  test("weekly on Monday", () => {
    // 2026-03-20 is a Friday
    const after = Date.UTC(2026, 2, 20, 10, 0, 0);
    const next = getNextOccurrence("0 9 * * 1", after);
    const d = new Date(next);
    expect(d.getUTCDay()).toBe(1); // Monday
    expect(d.getUTCDate()).toBe(23);
    expect(d.getUTCHours()).toBe(9);
  });

  test("monthly on 1st", () => {
    const after = Date.UTC(2026, 2, 20, 10, 0, 0);
    const next = getNextOccurrence("0 9 1 * *", after);
    const d = new Date(next);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCMonth()).toBe(3); // April
    expect(d.getUTCHours()).toBe(9);
  });

  test("every 15 minutes", () => {
    const after = Date.UTC(2026, 2, 20, 10, 7, 0);
    const next = getNextOccurrence("*/15 * * * *", after);
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(15);
    expect(d.getUTCHours()).toBe(10);
  });

  test("handles month boundaries", () => {
    // Jan 31 — next occurrence on the 1st should be Feb 1
    const after = Date.UTC(2026, 0, 31, 10, 0, 0);
    const next = getNextOccurrence("0 9 1 * *", after);
    const d = new Date(next);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCMonth()).toBe(1); // February
  });

  test("handles day-of-week filtering", () => {
    // Only on weekdays (Mon-Fri)
    // 2026-03-21 is Saturday
    const after = Date.UTC(2026, 2, 21, 0, 0, 0);
    const next = getNextOccurrence("0 9 * * 1-5", after);
    const d = new Date(next);
    expect(d.getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(d.getUTCDay()).toBeLessThanOrEqual(5);
    expect(d.getUTCDate()).toBe(23); // Monday
  });

  test("skips to next valid minute", () => {
    const after = Date.UTC(2026, 2, 20, 9, 0, 0);
    const next = getNextOccurrence("30 9 * * *", after);
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(30);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCDate()).toBe(20);
  });
});

describe("describeCron", () => {
  test("daily at midnight", () => {
    expect(describeCron("0 0 * * *")).toBe("Daily at midnight UTC");
  });

  test("daily at specific time", () => {
    expect(describeCron("0 9 * * *")).toBe("Daily at 09:00 UTC");
    expect(describeCron("30 14 * * *")).toBe("Daily at 14:30 UTC");
  });

  test("weekly schedule", () => {
    const desc = describeCron("0 9 * * 1");
    expect(desc).toContain("Mon");
    expect(desc).toContain("09:00 UTC");
  });

  test("monthly schedule", () => {
    const desc = describeCron("0 9 1 * *");
    expect(desc).toContain("Monthly");
    expect(desc).toContain("day 1");
  });

  test("every N minutes", () => {
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
  });

  test("invalid expression", () => {
    const desc = describeCron("invalid");
    expect(desc).toContain("Invalid");
  });
});
