export function getDueDateInfo(dueDate: number): { label: string; className: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMs = today.getTime();
  const tomorrowMs = todayMs + 86400000;
  const weekMs = todayMs + 7 * 86400000;

  const date = new Date(dueDate);
  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  if (dueDate < todayMs) return { label: `Overdue ${dateStr}`, className: "due-overdue" };
  if (dueDate < tomorrowMs) return { label: "Due today", className: "due-today" };
  if (dueDate < weekMs) return { label: `Due ${dateStr}`, className: "due-soon" };
  return { label: `Due ${dateStr}`, className: "due-future" };
}

export function dateToTimestamp(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

export function timestampToDateStr(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
