import { cn } from "@/ui/lib/utils";

/** Root row for a log line (flex + optional stream accent). */
export function logLineRootClass(stream: string, extra?: string): string {
  const byStream: Record<string, string> = {
    assistant:
      "border-l-2 border-blue-500/50 pl-2 text-slate-800 dark:text-slate-100",
    stderr: "text-destructive",
    error: "text-destructive bg-destructive/5",
    tool: "pl-2 text-violet-700 dark:text-violet-300",
    "tool-result": "text-muted-foreground",
    mcp: "text-emerald-600 dark:text-emerald-400",
    system: "text-muted-foreground",
    completion: "border-l-2 border-emerald-500/40 pl-2 text-emerald-800 dark:text-emerald-200",
    prompt: "text-amber-900/90 dark:text-amber-100",
  };
  return cn("flex items-start gap-2 py-px", byStream[stream] ?? "pl-2 text-foreground", extra);
}

export const logToolCardClass =
  "my-1 rounded-sm bg-secondary px-3 py-2 font-mono text-xs leading-relaxed";

export const logToolCardSkillClass = cn(logToolCardClass, "border border-violet-500/20");

export const logToolCardHeaderClass = "flex flex-wrap items-center gap-2";

export const logExpandToggleClass =
  "cursor-pointer border-0 bg-transparent p-0 text-[10px] text-muted-foreground hover:text-foreground";

export const logBashCommandPreClass =
  "mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground";

export const logToolInputPreClass =
  "mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted px-2 py-1.5 font-mono text-[11px]";

export const logDiffWrapClass = "mt-1 grid gap-1";

export const logDiffOldPreClass =
  "overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-red-500/10 px-2 py-1 font-mono text-[11px] text-red-900 dark:text-red-200";

export const logDiffNewPreClass =
  "overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-900 dark:text-emerald-200";

export const logResultBlockClass = "mb-1 ml-[18px] border-l-2 border-border pl-2.5";

export const logResultHeaderClass = (expandable: boolean) =>
  cn(
    "flex flex-wrap items-center gap-2 text-[11px]",
    expandable && "cursor-pointer",
  );

export const logResultPreClass =
  "mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted px-2 py-1.5 font-mono text-[11px]";

export const logTextMutedClass = "text-muted-foreground";

export const logHookOutputClass = "text-muted-foreground";

export const logCompletionStatsClass = "text-[11px] text-muted-foreground";

export const logCompletionResultWrapClass = "mt-1";

export const logPermissionCardClass = cn(logToolCardClass, "border border-amber-500/25");

/** shadcn Badge `className` overrides for log chip colors. */
export const logBadgeClasses = {
  assistant: "border-transparent bg-blue-500/15 text-blue-800 dark:text-blue-200",
  tool: "border-transparent bg-violet-500/15 text-violet-800 dark:text-violet-200",
  result: "border-transparent bg-muted text-muted-foreground",
  mcp: "border-transparent bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  error: "border-transparent bg-destructive/15 text-destructive",
  permission: "border-transparent bg-amber-500/15 text-amber-900 dark:text-amber-100",
  system: "border-transparent bg-muted text-muted-foreground",
  completion: "border-transparent bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  prompt: "border-transparent bg-amber-500/15 text-amber-900 dark:text-amber-100",
  skill: "border-transparent bg-fuchsia-500/15 text-fuchsia-900 dark:text-fuchsia-100",
} as const;

export type LogBadgeKind = keyof typeof logBadgeClasses;

export function logTodoItemClass(status: string): string {
  const m: Record<string, string> = {
    completed: "text-muted-foreground line-through opacity-70",
    in_progress: "font-medium text-foreground",
    pending: "text-muted-foreground",
  };
  return cn("flex items-start gap-1.5", m[status] ?? "text-muted-foreground");
}

export function logTodoCountClass(kind: "done" | "active" | "pending"): string {
  const m = {
    done: "text-emerald-600 dark:text-emerald-400",
    active: "text-amber-600 dark:text-amber-400",
    pending: "text-muted-foreground",
  };
  return m[kind];
}
