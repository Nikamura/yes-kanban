import { KANBAN_COLUMNS, parseCsvRows, type ImportedIssue } from "./index";

/**
 * Map a Jira status to a kanban column.
 */
export function mapJiraStatus(status: string): string {
  const normalized = status.toLowerCase().trim();
  switch (normalized) {
    case "in progress":
    case "in review":
    case "in development":
      return KANBAN_COLUMNS.IN_PROGRESS;
    case "done":
    case "closed":
    case "resolved":
    case "complete":
      return KANBAN_COLUMNS.DONE;
    case "to do":
    case "open":
    case "backlog":
    case "new":
    case "reopened":
    default:
      return KANBAN_COLUMNS.TODO;
  }
}

/**
 * Parse a Jira CSV export into ImportedIssues.
 *
 * Expected CSV columns: Summary, Description, Status, Priority, Labels, Issue key
 */
export function parseJiraCsv(csv: string): ImportedIssue[] {
  const rows = parseCsvRows(csv);
  return rows.map((fields) => {
    const [summary, description, status, priority, labels, issueKey] = fields;
    return {
      title: summary ?? "",
      description: description ?? "",
      status: mapJiraStatus(status ?? ""),
      priority: priority || undefined, // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string should map to undefined
      tags: labels ? labels.split(",").map((l) => l.trim()).filter(Boolean) : [],
      externalId: `jira-${issueKey ?? ""}`,
    };
  });
}
