/** Column names that represent terminal/completed states on the board. */
export const TERMINAL_COLUMN_NAMES = ["Done"] as const;

/** Agents must not move issues into terminal columns (defense in depth; MCP does not expose move_issue). */
export function isAgentForbiddenMoveTarget(
  status: string,
  actor: "user" | "agent" | undefined
): boolean {
  return actor === "agent" && (TERMINAL_COLUMN_NAMES as readonly string[]).includes(status);
}

/** Fixed board flow (order is defined by column `position` in the database). */
export const FIXED_COLUMNS = ["Backlog", "To Do", "In Progress", "Done"] as const;

/** Columns where new issues may be created. */
export const CREATABLE_COLUMNS = ["Backlog", "To Do"] as const;

/** Columns where dropping/creating an issue can trigger auto-dispatch (workspace creation). */
export const AUTO_DISPATCH_COLUMNS = ["To Do"] as const;
