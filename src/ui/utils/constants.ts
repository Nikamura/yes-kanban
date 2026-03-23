export {
  TERMINAL_COLUMN_NAMES,
  CREATABLE_COLUMNS,
  FIXED_COLUMNS,
} from "../../../convex/lib/boardConstants";

export const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "merged", "merge_failed", "conflict", "test_failed", "changes_requested"];

export const RETRYABLE_STATUSES = ["failed", "test_failed", "changes_requested", "merge_failed", "cancelled"];

export const CANCELLABLE_STATUSES = ["creating", "claimed", "planning", "grilling", "plan_reviewing", "awaiting_feedback", "waiting_for_answer", "coding", "testing", "reviewing", "rebasing", "creating_pr", "merging"];
