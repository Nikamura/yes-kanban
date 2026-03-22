const FORMULA_CHARS = new Set(["=", "+", "-", "@"]);

/**
 * Escapes a value for safe inclusion in a CSV cell.
 * Prevents formula injection by prefixing dangerous leading characters
 * (=, +, -, @) with a single quote, per OWASP recommendations.
 */
export function escapeCsv(val: string): string {
  let sanitized = val;
  const firstChar = sanitized[0];
  if (firstChar !== undefined && FORMULA_CHARS.has(firstChar)) {
    sanitized = "'" + sanitized;
  }
  if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n")) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}
