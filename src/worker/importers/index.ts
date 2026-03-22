/**
 * Common interface for issues imported from external sources.
 */
export interface ImportedIssue {
  title: string;
  description: string;
  status: string;
  priority?: string;
  tags: string[];
  externalId: string;
}

/** Standard kanban column names used as mapping targets. */
export const KANBAN_COLUMNS = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
} as const;

/**
 * Parse a simple CSV string into rows of field arrays.
 * Handles quoted fields containing commas and escaped quotes.
 */
export function parseCsvRows(csv: string): string[][] {
  const lines = csv.trim().split("\n");
  if (lines.length <= 1) return [];

  // Skip header row
  return lines.slice(1).map(parseCsvLine).filter((row) => row.length > 0);
}

/**
 * Parse a single CSV line, respecting quoted fields.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}
