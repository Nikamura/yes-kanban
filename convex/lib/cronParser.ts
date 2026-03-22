/**
 * Minimal 5-field cron expression parser.
 * Fields: minute hour day-of-month month day-of-week
 * Supports: numbers, asterisk, ranges (1-5), steps (star/15), lists (1,3,5)
 */

interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range: string;
    let step = 1;
    if (stepMatch) {
      range = stepMatch[1] ?? part;
      step = parseInt(stepMatch[2] ?? "1", 10);
      if (step < 1) throw new Error(`Invalid step: ${step}`);
    } else {
      range = part;
    }

    let start: number;
    let end: number;

    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const rangeParts = range.split("-").map(Number);
      const a = rangeParts[0] ?? NaN;
      const b = rangeParts[1] ?? NaN;
      if (isNaN(a) || isNaN(b) || a < min || b > max || a > b) {
        throw new Error(`Invalid range: ${range}`);
      }
      start = a;
      end = b;
    } else {
      const n = parseInt(range, 10);
      if (isNaN(n) || n < min || n > max) {
        throw new Error(`Invalid value: ${range} (expected ${min}-${max})`);
      }
      if (stepMatch) {
        start = n;
        end = max;
      } else {
        values.add(n);
        continue;
      }
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return [...values].sort((a, b) => a - b);
}

function parseCronFields(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected 5 fields, got ${parts.length}`);
  }
  // After the length check, all 5 indices are guaranteed to exist
  const p0 = parts[0] as string;
  const p1 = parts[1] as string;
  const p2 = parts[2] as string;
  const p3 = parts[3] as string;
  const p4 = parts[4] as string;
  return {
    minutes: parseField(p0, 0, 59),
    hours: parseField(p1, 0, 23),
    daysOfMonth: parseField(p2, 1, 31),
    months: parseField(p3, 1, 12),
    daysOfWeek: parseField(p4, 0, 6),
  };
}

export function validateCron(expression: string): string | null {
  try {
    parseCronFields(expression);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Get the next occurrence after `after` (epoch ms).
 * Returns epoch ms of next fire time.
 */
export function getNextOccurrence(expression: string, after: number): number {
  const fields = parseCronFields(expression);
  const d = new Date(after);
  // Start from the next minute
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  // Safety: limit iterations to prevent infinite loops
  const maxIterations = 366 * 24 * 60; // ~1 year of minutes
  for (let i = 0; i < maxIterations; i++) {
    const month = d.getUTCMonth() + 1;
    if (!fields.months.includes(month)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const day = d.getUTCDate();
    const dow = d.getUTCDay();
    const maxDay = daysInMonth(d.getUTCFullYear(), month);
    if (day > maxDay || !fields.daysOfMonth.includes(day) || !fields.daysOfWeek.includes(dow)) {
      d.setUTCDate(day + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const hour = d.getUTCHours();
    if (!fields.hours.includes(hour)) {
      d.setUTCHours(hour + 1, 0, 0, 0);
      continue;
    }

    const minute = d.getUTCMinutes();
    if (!fields.minutes.includes(minute)) {
      d.setUTCMinutes(minute + 1, 0, 0);
      continue;
    }

    return d.getTime();
  }

  throw new Error("Could not find next occurrence within search limit");
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human-readable description of a cron expression. */
export function describeCron(expression: string): string {
  const err = validateCron(expression);
  if (err) return `Invalid: ${err}`;

  const parts = expression.trim().split(/\s+/);
  const min = parts[0] ?? "*";
  const hour = parts[1] ?? "*";
  const dom = parts[2] ?? "*";
  const month = parts[3] ?? "*";
  const dow = parts[4] ?? "*";

  // Common presets
  if (expression === "0 0 * * *") return "Daily at midnight UTC";
  if (min !== "*" && hour !== "*" && dom === "*" && month === "*" && dow === "*") {
    return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  }
  if (min !== "*" && hour !== "*" && dom === "*" && month === "*" && dow !== "*") {
    const days = parseField(dow, 0, 6).map((d) => DOW_NAMES[d] ?? "?").join(", ");
    return `${days} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  }
  if (min !== "*" && hour !== "*" && dom !== "*" && month === "*" && dow === "*") {
    return `Monthly on day ${dom} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  }
  if (min.startsWith("*/")) {
    return `Every ${min.slice(2)} minutes`;
  }

  // Fallback
  const descParts: string[] = [];
  if (min !== "*") descParts.push(`minute ${min}`);
  if (hour !== "*") descParts.push(`hour ${hour}`);
  if (dom !== "*") descParts.push(`day ${dom}`);
  if (month !== "*") {
    const months = parseField(month, 1, 12).map((m) => MONTH_NAMES[m - 1] ?? "?").join(", ");
    descParts.push(`in ${months}`);
  }
  if (dow !== "*") {
    const days = parseField(dow, 0, 6).map((d) => DOW_NAMES[d] ?? "?").join(", ");
    descParts.push(`on ${days}`);
  }
  return descParts.join(", ");
}

/** Preset cron expressions for common schedules. */
export const CRON_PRESETS: Record<string, string> = {
  daily: "0 9 * * *",
  weekly: "0 9 * * 1",
  monthly: "0 9 1 * *",
};
