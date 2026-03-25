import type { FlatDiffItem } from "../diffParse";
import { cn } from "@/ui/lib/utils";

export const diffFileStatusClass: Record<string, string> = {
  added: "text-emerald-600 dark:text-emerald-400",
  deleted: "text-destructive",
  modified: "text-amber-600 dark:text-amber-400",
};

export function diffFileStatusTextClass(status: string): string {
  return diffFileStatusClass[status] ?? "text-muted-foreground";
}

/** Virtualized file-section row chrome (borders between files). */
export function diffVirtSectionClass(item: FlatDiffItem, totalFiles: number): string {
  return cn(
    "overflow-hidden border-x border-border bg-card",
    item.isFirstInFile && "rounded-t-sm border-t border-border",
    item.isLastInFile && "rounded-b-sm border-b border-border",
    item.isLastInFile && item.fileIndex < totalFiles - 1 && "pb-4",
  );
}

export const diffUnifiedPreClass = "m-0 font-mono text-[12px] leading-snug";

export const diffHunkHeaderClass =
  "border-b border-border bg-card px-2 py-1.5 text-[12px] whitespace-pre-wrap break-all text-muted-foreground";

export const diffLineNumClass =
  "border-r border-border bg-card px-1.5 py-0 text-right text-[11px] tabular-nums text-muted-foreground select-none overflow-hidden text-ellipsis";

export const diffLineContentClass = "min-w-0 overflow-x-auto whitespace-pre px-2 py-0";

export const diffBinaryNoteClass = "m-0 px-4 py-3 text-[12px] text-muted-foreground";
