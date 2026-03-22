import { parseCsvRows, type ImportedIssue } from "./index";

/**
 * Parse a generic CSV export (the format produced by our own exporter) into ImportedIssues.
 *
 * Expected CSV columns: Title, Description, Status, Priority, Tags, External ID
 */
export function parseGenericCsv(csv: string): ImportedIssue[] {
  const rows = parseCsvRows(csv);
  return rows.map((fields, idx) => {
    const [title, description, status, priority, tags, externalId] = fields;
    return {
      title: title ?? "",
      description: description ?? "",
      status: status || "To Do", // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string should use fallback
      priority: priority || undefined, // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string should map to undefined
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      externalId: externalId || `csv-${idx}`, // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string should use fallback
    };
  });
}
