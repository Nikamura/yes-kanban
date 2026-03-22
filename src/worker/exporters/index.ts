import type { ImportedIssue } from "../importers/index";

/**
 * Escape a CSV field: wrap in quotes if it contains commas, quotes, or newlines.
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export issues to a JSON string.
 */
export function exportToJson(issues: ImportedIssue[]): string {
  return JSON.stringify(issues, null, 2);
}

/**
 * Export issues to CSV format.
 */
export function exportToCsv(issues: ImportedIssue[]): string {
  const header = "Title,Description,Status,Priority,Tags,External ID";
  if (issues.length === 0) return header;

  const rows = issues.map((issue) => {
    return [
      escapeCsvField(issue.title),
      escapeCsvField(issue.description),
      escapeCsvField(issue.status),
      escapeCsvField(issue.priority ?? ""),
      escapeCsvField(issue.tags.join(",")),
      escapeCsvField(issue.externalId),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}
