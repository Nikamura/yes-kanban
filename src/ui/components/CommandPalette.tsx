import { useState, useEffect, useRef } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";

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

  // Use refs so the keydown effect doesn't need to re-register on every render
  const filteredRef = useRef(filtered);
  const selectedIndexRef = useRef(selectedIndex);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    filteredRef.current = filtered;
    selectedIndexRef.current = selectedIndex;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
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
    <div className="dialog-overlay command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          placeholder="Type a command or search issues..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <div className="command-palette-results" ref={listRef}>
          {filtered.length === 0 && (
            <div className="command-palette-empty">No results found</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              className={`command-palette-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => {
                onClose();
                item.action();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="command-palette-item-label">{item.label}</span>
              {item.shortcut && (
                <kbd className="command-palette-item-shortcut">{item.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
