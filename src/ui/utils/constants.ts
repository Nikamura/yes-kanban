import { VALID_CARD_COLORS } from "../../../convex/lib/issueValidation";

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#EF4444",
  high: "#F97316",
  medium: "#EAB308",
  low: "#6B7280",
};

const CARD_COLOR_NAMES: Record<string, string> = {
  "#EF4444": "Red",
  "#F97316": "Orange",
  "#EAB308": "Yellow",
  "#10B981": "Green",
  "#3B82F6": "Blue",
  "#6366F1": "Indigo",
  "#8B5CF6": "Purple",
  "#EC4899": "Pink",
};

export const CARD_COLORS = VALID_CARD_COLORS.map((value) => ({
  name: CARD_COLOR_NAMES[value] ?? value,
  value,
}));

export const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "merged", "merge_failed", "conflict", "test_failed", "changes_requested"];

export const TERMINAL_COLUMN_NAMES = ["Done", "Cancelled"];

export const RETRYABLE_STATUSES = ["failed", "test_failed", "changes_requested", "merge_failed", "cancelled"];

export const CANCELLABLE_STATUSES = ["creating", "claimed", "planning", "plan_reviewing", "awaiting_feedback", "coding", "testing", "reviewing", "rebasing", "creating_pr", "merging"];
