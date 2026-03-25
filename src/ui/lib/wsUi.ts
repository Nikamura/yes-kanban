import { cn } from "@/ui/lib/utils";

/** Workspace lifecycle badge in header (pill). */
export function wsWorkspaceStatusClass(status: string): string {
  const byStatus: Record<string, string> = {
    coding: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
    completed: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
    merged: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
    failed: "text-destructive bg-destructive/10",
    merge_failed: "text-destructive bg-destructive/10",
    test_failed: "text-destructive bg-destructive/10",
    creating: "text-blue-600 bg-blue-500/10 dark:text-blue-400",
    claimed: "text-blue-600 bg-blue-500/10 dark:text-blue-400",
    review: "text-violet-600 bg-violet-500/10 dark:text-violet-400",
    queued: "text-muted-foreground bg-muted",
    testing: "text-violet-600 bg-violet-500/10",
    reviewing: "text-violet-600 bg-violet-500/10",
    rebasing: "text-amber-600 bg-amber-500/10",
    pr_open: "text-blue-600 bg-blue-500/10",
    running: "text-amber-600 bg-amber-500/10",
    succeeded: "text-emerald-600 bg-emerald-500/10",
    timed_out: "text-destructive bg-destructive/10",
    cancelled: "text-muted-foreground bg-muted",
    abandoned: "text-muted-foreground bg-muted",
    conflict: "text-destructive bg-destructive/10",
    changes_requested: "text-orange-600 bg-orange-500/10 dark:text-orange-400",
    planning: "text-violet-600 bg-violet-500/10",
    grilling: "text-pink-600 bg-pink-500/10 dark:text-pink-400",
    plan_reviewing: "text-violet-600 bg-violet-500/10",
    awaiting_feedback: "text-orange-600 bg-orange-500/10 dark:text-orange-400",
    waiting_for_answer: "text-orange-600 bg-orange-500/10 dark:text-orange-400",
  };
  return cn(
    "inline-flex max-w-full items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide",
    byStatus[status] ?? "text-muted-foreground bg-muted",
  );
}

/** Small run-attempt status chip on attempt selector buttons. */
export function wsRunAttemptStatusClass(status: string): string {
  const byStatus: Record<string, string> = {
    running: "text-amber-600",
    succeeded: "text-emerald-600",
    failed: "text-destructive",
    abandoned: "text-muted-foreground",
    cancelled: "text-muted-foreground",
    timed_out: "text-destructive",
  };
  return cn("font-mono text-[10px]", byStatus[status] ?? "text-muted-foreground");
}
