import { KANBAN_COLUMNS, parseCsvRows, type ImportedIssue } from "./index";

/**
 * Map a Linear workflow state to a kanban column.
 */
export function mapLinearStatus(status: string): string {
  const normalized = status.toLowerCase().trim();
  switch (normalized) {
    case "in progress":
    case "in review":
    case "started":
      return KANBAN_COLUMNS.IN_PROGRESS;
    case "done":
    case "completed":
    case "cancelled":
    case "canceled":
      return KANBAN_COLUMNS.DONE;
    case "backlog":
    case "todo":
    case "triage":
    case "unstarted":
    default:
      return KANBAN_COLUMNS.TODO;
  }
}

/**
 * Parse a Linear CSV export into ImportedIssues.
 *
 * Expected CSV columns: Title, Description, Status, Priority, Labels, Identifier
 */
export function parseLinearCsv(csv: string): ImportedIssue[] {
  const rows = parseCsvRows(csv);
  return rows.map((fields) => {
    const [title, description, status, priority, labels, identifier] = fields;
    return {
      title: title ?? "",
      description: description ?? "",
      status: mapLinearStatus(status ?? ""),
      priority: priority || undefined, // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string should map to undefined
      tags: labels ? labels.split(",").map((l) => l.trim()).filter(Boolean) : [],
      externalId: `linear-${identifier ?? ""}`,
    };
  });
}
