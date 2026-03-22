export type ColumnLike = {
  name: string;
  position: number;
  visible: boolean;
};

/**
 * Given a list of columns and a current column name, returns the next visible
 * column by position, or null if there is none.
 */
export function getNextVisibleColumn<T extends ColumnLike>(
  columns: T[],
  currentColumnName: string,
): T | null {
  const current = columns.find((c) => c.name === currentColumnName);
  if (!current) return null;

  const candidates = columns
    .filter((c) => c.visible && c.position > current.position)
    .sort((a, b) => a.position - b.position);

  return candidates[0] ?? null;
}
