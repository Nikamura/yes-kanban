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

// NOTE: diffUnifiedPreClass, diffHunkHeaderClass, diffLineNumClass,
// diffLineContentClass, and diffBinaryNoteClass are inlined directly in
// DiffViewer.tsx so Tailwind v4's @tailwindcss/vite plugin eagerly generates
// their utility classes (it only scans files in the Vite module graph).
