import { useState, useEffect, useRef } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Input } from "@/ui/components/ui/input";
import { cn } from "@/ui/lib/utils";

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  issues: Doc<"issues">[];
  columns: string[];
  onClose: () => void;
  onNewIssue: () => void;
  onOpenIssue: (simpleId: string) => void;
  onMoveFocused: () => void;
  onShowHelp: () => void;
  onSwitchColumn: (index: number) => void;
  onFocusSearch: () => void;
}

export function CommandPalette({
  issues,
  columns,
  onClose,
  onNewIssue,
  onOpenIssue,
  onMoveFocused,
  onShowHelp,
  onSwitchColumn,
  onFocusSearch,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: CommandItem[] = [
    { id: "new-issue", label: "New issue", shortcut: "c", action: onNewIssue },
    { id: "move-issue", label: "Move focused issue", shortcut: "m", action: onMoveFocused },
    { id: "focus-search", label: "Focus search", shortcut: "/", action: onFocusSearch },
    { id: "show-help", label: "Show keyboard shortcuts", shortcut: "?", action: onShowHelp },
    ...columns.map((col, i) => ({
      id: `switch-col-${i}`,
      label: `Switch to ${col}`,
      shortcut: i < 9 ? `${i + 1}` : undefined,
      action: () => onSwitchColumn(i),
    })),
  ];

  const issueItems: CommandItem[] = issues.map((issue) => ({
    id: `issue-${issue._id}`,
    label: `${issue.simpleId}: ${issue.title}`,
    action: () => onOpenIssue(issue.simpleId),
  }));

  const allItems = [...commands, ...issueItems];

  const filtered = query
    ? allItems.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  const filteredRef = useRef(filtered);
  const selectedIndexRef = useRef(selectedIndex);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    filteredRef.current = filtered;
    selectedIndexRef.current = selectedIndex;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const items = filteredRef.current;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter": {
          e.preventDefault();
          const item = items[selectedIndexRef.current];
          if (item) {
            onCloseRef.current();
            item.action();
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          onCloseRef.current();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center bg-black/40 p-4 pt-[15vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          ref={inputRef}
          type="text"
          className="rounded-none border-0 border-b border-border px-4 py-3 text-base focus-visible:ring-0"
          placeholder="Type a command or search issues..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          autoComplete="off"
        />
        <div className="max-h-[min(50vh,360px)] overflow-y-auto p-1" ref={listRef}>
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No results found</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                i === selectedIndex ? "bg-muted text-foreground" : "hover:bg-muted/60",
              )}
              onClick={() => {
                onClose();
                item.action();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              {item.shortcut && (
                <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
