import type { CSSProperties } from "react";

/** Structural classes; pair with {@link wsStatusStyle} for dynamic colors. */
export const wsStatusBadgeClass =
  "inline-block rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase font-mono";

/** Smaller badge used on issue cards (mono + compact). */
export const wsStatusCardBadgeClass =
  "ml-auto rounded px-1 py-px text-[9px] font-mono";

type StatusColors = Pick<CSSProperties, "color" | "backgroundColor">;

/** Maps workspace / run status strings to theme-aware inline colors (replaces `.ws-status-*` CSS). */
export function wsStatusStyle(status: string): StatusColors {
  const s = STATUS_STYLES[status];
  if (s) return s;
  return {
    color: "var(--muted-foreground)",
    backgroundColor: "var(--muted)",
  };
}

const STATUS_STYLES: Record<string, StatusColors> = {
  coding: { color: "#F59E0B", backgroundColor: "rgba(245, 158, 11, 0.1)" },
  completed: { color: "#10B981", backgroundColor: "rgba(16, 185, 129, 0.1)" },
  merged: { color: "#10B981", backgroundColor: "rgba(16, 185, 129, 0.1)" },
  failed: { color: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.1)" },
  merge_failed: { color: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.1)" },
  creating: { color: "#3B82F6", backgroundColor: "rgba(59, 130, 246, 0.1)" },
  claimed: { color: "#3B82F6", backgroundColor: "rgba(59, 130, 246, 0.1)" },
  review: { color: "#A78BFA", backgroundColor: "rgba(167, 139, 250, 0.1)" },
  queued: { color: "var(--muted-foreground)", backgroundColor: "transparent" },

  testing: { color: "#8B5CF6", backgroundColor: "rgba(139, 92, 246, 0.1)" },
  reviewing: { color: "#8B5CF6", backgroundColor: "rgba(139, 92, 246, 0.1)" },
  rebasing: { color: "#F59E0B", backgroundColor: "rgba(245, 158, 11, 0.1)" },
  pr_open: { color: "#3B82F6", backgroundColor: "rgba(59, 130, 246, 0.1)" },
  running: { color: "#F59E0B", backgroundColor: "rgba(245, 158, 11, 0.1)" },
  succeeded: { color: "#10B981", backgroundColor: "rgba(16, 185, 129, 0.1)" },
  timed_out: { color: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.1)" },
  cancelled: { color: "#6B7280", backgroundColor: "rgba(107, 114, 128, 0.12)" },
  abandoned: { color: "#6B7280", backgroundColor: "rgba(107, 114, 128, 0.12)" },
  conflict: { color: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.1)" },
  changes_requested: { color: "#F97316", backgroundColor: "rgba(249, 115, 22, 0.1)" },
  test_failed: { color: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.1)" },
  planning: { color: "#8B5CF6", backgroundColor: "rgba(139, 92, 246, 0.1)" },
  grilling: { color: "#EC4899", backgroundColor: "rgba(236, 72, 153, 0.1)" },
  plan_reviewing: { color: "#8B5CF6", backgroundColor: "rgba(139, 92, 246, 0.1)" },
  awaiting_feedback: { color: "#F97316", backgroundColor: "rgba(249, 115, 22, 0.1)" },
  waiting_for_answer: { color: "#F97316", backgroundColor: "rgba(249, 115, 22, 0.1)" },
};
