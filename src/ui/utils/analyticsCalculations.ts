const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface HistoryEntry {
  issueId: string;
  action: string;
  field: string;
  oldValue?: string;
  newValue?: string;
  timestamp: number;
}

export interface ColumnDef {
  name: string;
  color: string;
  position: number;
}

export function weekKey(ts: number): string {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseHistoryValue(val?: string): string {
  if (!val) return "";
  try {
    const parsed = JSON.parse(val);
    return typeof parsed === "string" ? parsed : val;
  } catch {
    return val;
  }
}

export function isStatusChange(h: HistoryEntry): boolean {
  return (h.action === "moved" || h.action === "updated") && h.field === "status";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function getCompletionColumnName(columns: ColumnDef[]): string {
  if (columns.length === 0) return "";
  return columns[columns.length - 1]?.name ?? "";
}

export function getTerminalColumnNames(columns: ColumnDef[]): Set<string> {
  if (columns.length === 0) return new Set();
  const last = columns[columns.length - 1];
  return new Set(last ? [last.name] : []);
}

export function getLastCompletionMap(
  history: HistoryEntry[],
  completionCol: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const h of history) {
    if (isStatusChange(h) && parseHistoryValue(h.newValue) === completionCol) {
      map.set(h.issueId, h.timestamp);
    }
  }
  return map;
}

export function computeCycleTime(
  history: HistoryEntry[],
  columns: ColumnDef[],
): { average: number; trend: { week: string; avgDays: number }[] } {
  if (history.length === 0 || columns.length === 0) return { average: 0, trend: [] };

  const completionCol = getCompletionColumnName(columns);
  const terminalCols = getTerminalColumnNames(columns);
  const columnByName = new Map(columns.map((c) => [c.name, c]));
  const issueFirstWork = new Map<string, number>();
  const issueDone = new Map<string, number>();

  for (const h of history) {
    if (isStatusChange(h)) {
      const newVal = parseHistoryValue(h.newValue);
      const col = columnByName.get(newVal);
      if (col && col.position > 0 && !terminalCols.has(col.name)) {
        if (!issueFirstWork.has(h.issueId)) {
          issueFirstWork.set(h.issueId, h.timestamp);
        }
      }
      if (newVal === completionCol) {
        issueDone.set(h.issueId, h.timestamp);
      }
    }
  }

  const cycleTimes: { days: number; doneAt: number }[] = [];
  for (const [issueId, doneAt] of issueDone) {
    const startAt = issueFirstWork.get(issueId);
    if (startAt && doneAt > startAt) {
      cycleTimes.push({ days: (doneAt - startAt) / DAY_MS, doneAt });
    }
  }

  const average = cycleTimes.length > 0
    ? cycleTimes.reduce((sum, ct) => sum + ct.days, 0) / cycleTimes.length
    : 0;

  const byWeek = new Map<string, number[]>();
  for (const ct of cycleTimes) {
    const wk = weekKey(ct.doneAt);
    const arr = byWeek.get(wk) ?? [];
    arr.push(ct.days);
    byWeek.set(wk, arr);
  }

  const trend = [...byWeek.entries()]
    .map(([week, days]) => ({
      week,
      avgDays: round1(days.reduce((a, b) => a + b, 0) / days.length),
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return { average: round1(average), trend };
}

export function computeThroughput(
  history: HistoryEntry[],
  columns: ColumnDef[],
): { weekly: { week: string; count: number }[]; monthly: { month: string; count: number }[] } {
  if (history.length === 0 || columns.length === 0) return { weekly: [], monthly: [] };

  const issueLastCompletion = getLastCompletionMap(history, getCompletionColumnName(columns));

  const weeklyMap = new Map<string, number>();
  const monthlyMap = new Map<string, number>();
  for (const ts of issueLastCompletion.values()) {
    const wk = weekKey(ts);
    weeklyMap.set(wk, (weeklyMap.get(wk) ?? 0) + 1);
    const mo = monthKey(ts);
    monthlyMap.set(mo, (monthlyMap.get(mo) ?? 0) + 1);
  }

  return {
    weekly: [...weeklyMap.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week)),
    monthly: [...monthlyMap.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export function computeCreatedVsCompleted(
  history: HistoryEntry[],
  columns: ColumnDef[],
): { week: string; created: number; completed: number }[] {
  if (history.length === 0 || columns.length === 0) return [];

  const completionCol = getCompletionColumnName(columns);
  const weeklyCreated = new Map<string, number>();

  const issueLastCompletion = getLastCompletionMap(history, completionCol);
  for (const h of history) {
    if (h.action === "created") {
      const wk = weekKey(h.timestamp);
      weeklyCreated.set(wk, (weeklyCreated.get(wk) ?? 0) + 1);
    }
  }

  const weeklyCompleted = new Map<string, number>();
  for (const ts of issueLastCompletion.values()) {
    const wk = weekKey(ts);
    weeklyCompleted.set(wk, (weeklyCompleted.get(wk) ?? 0) + 1);
  }

  const allWeeks = new Set([...weeklyCreated.keys(), ...weeklyCompleted.keys()]);
  return [...allWeeks].sort().map((week) => ({
    week,
    created: weeklyCreated.get(week) ?? 0,
    completed: weeklyCompleted.get(week) ?? 0,
  }));
}

export interface CumulativeFlowEntry {
  date: string;
  [column: string]: string | number;
}

const MAX_FLOW_POINTS = 365;

export function computeCumulativeFlow(
  history: HistoryEntry[],
  columns: ColumnDef[],
  endTime: number,
): CumulativeFlowEntry[] {
  if (history.length === 0 || columns.length === 0) return [];

  const columnNames = columns.map((c) => c.name);
  const columnSet = new Set(columnNames);
  const firstCol = columnNames[0] ?? "";

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const startDay = Math.floor((sorted[0]?.timestamp ?? 0) / DAY_MS) * DAY_MS;
  const endDay = Math.floor(endTime / DAY_MS) * DAY_MS;

  // Downsample if range exceeds MAX_FLOW_POINTS days
  const totalDays = Math.floor((endDay - startDay) / DAY_MS) + 1;
  const stepDays = Math.max(1, Math.ceil(totalDays / MAX_FLOW_POINTS));
  const stepMs = stepDays * DAY_MS;

  // Maintain incremental counts to avoid O(issues) re-tally per snapshot
  const counts: Record<string, number> = {};
  for (const col of columnNames) counts[col] = 0;
  const issueColumn = new Map<string, string>();

  const moveIssue = (issueId: string, newCol: string) => {
    const oldCol = issueColumn.get(issueId);
    if (oldCol === newCol) return;
    if (oldCol && oldCol in counts) counts[oldCol] = (counts[oldCol] ?? 0) - 1;
    issueColumn.set(issueId, newCol);
    if (newCol in counts) counts[newCol] = (counts[newCol] ?? 0) + 1;
  };

  let histIdx = 0;
  const snapshots: CumulativeFlowEntry[] = [];
  let nextEmitDay = startDay;

  for (let day = startDay; day <= endDay; day += DAY_MS) {
    const dayEnd = day + DAY_MS;
    while (histIdx < sorted.length) {
      const h = sorted[histIdx];
      if (!h) break;
      if (h.timestamp >= dayEnd) break;
      if (h.action === "created") {
        moveIssue(h.issueId, firstCol);
      } else if (isStatusChange(h)) {
        const newVal = parseHistoryValue(h.newValue);
        if (columnSet.has(newVal)) {
          moveIssue(h.issueId, newVal);
        }
      }
      histIdx++;
    }

    if (day >= nextEmitDay || day === endDay) {
      snapshots.push({
        date: new Date(day).toISOString().slice(0, 10),
        ...counts,
      });
      nextEmitDay = day + stepMs;
    }
  }

  return snapshots;
}

export interface AvgTimePerColumnEntry {
  column: string;
  color: string;
  avgDays: number;
}

export function computeAvgTimePerColumn(
  history: HistoryEntry[],
  columns: ColumnDef[],
  endTime: number,
): AvgTimePerColumnEntry[] {
  if (history.length === 0 || columns.length === 0) return [];

  const columnSet = new Set(columns.map((c) => c.name));
  const terminalCols = getTerminalColumnNames(columns);
  const issueTimelines = new Map<string, { column: string; enteredAt: number }[]>();

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const firstCol = columns[0]?.name ?? "";

  for (const h of sorted) {
    if (h.action === "created") {
      issueTimelines.set(h.issueId, [{ column: firstCol, enteredAt: h.timestamp }]);
    } else if (isStatusChange(h)) {
      const newVal = parseHistoryValue(h.newValue);
      if (columnSet.has(newVal)) {
        const timeline = issueTimelines.get(h.issueId);
        if (timeline) {
          timeline.push({ column: newVal, enteredAt: h.timestamp });
        }
      }
    }
  }

  const columnTotalTime = new Map<string, number>();
  const columnIssueCount = new Map<string, number>();

  for (const timeline of issueTimelines.values()) {
    const seen = new Set<string>();
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      if (!entry) continue;
      if (terminalCols.has(entry.column)) continue;
      const nextEntry = timeline[i + 1];
      const exitAt = nextEntry ? nextEntry.enteredAt : endTime;
      const duration = exitAt - entry.enteredAt;
      columnTotalTime.set(entry.column, (columnTotalTime.get(entry.column) ?? 0) + duration);
      if (!seen.has(entry.column)) {
        columnIssueCount.set(entry.column, (columnIssueCount.get(entry.column) ?? 0) + 1);
        seen.add(entry.column);
      }
    }
  }

  return columns.map((col) => ({
    column: col.name,
    color: col.color,
    avgDays: (columnIssueCount.get(col.name) ?? 0) > 0
      ? round1((columnTotalTime.get(col.name) ?? 0) / (columnIssueCount.get(col.name) ?? 1) / DAY_MS)
      : 0,
  }));
}

export function computeSummary(
  history: HistoryEntry[],
  columns: ColumnDef[],
  avgCycleTime: number,
  startTime: number | undefined,
  endTime: number,
): { totalCreated: number; totalCompleted: number; avgCycleTime: number; throughputPerWeek: number } {
  if (history.length === 0) {
    return { totalCreated: 0, totalCompleted: 0, avgCycleTime: 0, throughputPerWeek: 0 };
  }

  const completionCol = getCompletionColumnName(columns);
  const totalCompleted = getLastCompletionMap(history, completionCol).size;
  let totalCreated = 0;
  for (const h of history) {
    if (h.action === "created") totalCreated++;
  }

  const start = startTime ?? (history[0]?.timestamp ?? endTime);
  const weeks = Math.max(1, (endTime - start) / WEEK_MS);
  const throughputPerWeek = round1(totalCompleted / weeks);

  return { totalCreated, totalCompleted, avgCycleTime, throughputPerWeek };
}
