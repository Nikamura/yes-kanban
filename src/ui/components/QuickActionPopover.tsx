import { useState, useEffect, useRef } from "react";
import { cn } from "@/ui/lib/utils";

interface QuickActionPopoverProps {
  columns: string[];
  currentStatus?: string;
  onMove: (status: string) => void;
  onClose: () => void;
}

export function QuickActionPopover({
  columns,
  currentStatus,
  onMove,
  onClose,
}: QuickActionPopoverProps) {
  const items = columns.map((c) => ({ value: c, label: c }));

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = items.findIndex((i) => i.value === currentStatus);
    return idx >= 0 ? idx : 0;
  });

  const stateRef = useRef({ items, selectedIndex, onMove, onClose });
  useEffect(() => {
    stateRef.current = { items, selectedIndex, onMove, onClose };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { items: itms, selectedIndex: idx, onMove: mv, onClose: cl } = stateRef.current;
      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => Math.min(prev + 1, itms.length - 1));
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter": {
          e.preventDefault();
          e.stopPropagation();
          const item = itms[idx];
          if (item) mv(item.value);
          cl();
          break;
        }
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          cl();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const handleSelect = (value: string) => {
    onMove(value);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-[280px] rounded-lg border border-border bg-card p-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-semibold">Move to column</h3>
        <div className="flex flex-col gap-0.5">
          {items.map((item, i) => (
            <button
              key={item.value}
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors",
                i === selectedIndex && "bg-muted",
                item.value === currentStatus && "font-medium",
              )}
              onClick={() => handleSelect(item.value)}
            >
              {item.label}
              {item.value === currentStatus && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">current</span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-3 text-center text-[11px] text-muted-foreground">
          <kbd className="rounded border border-border bg-muted px-1">j</kbd>/
          <kbd className="rounded border border-border bg-muted px-1">k</kbd> navigate ·{" "}
          <kbd className="rounded border border-border bg-muted px-1">Enter</kbd> select ·{" "}
          <kbd className="rounded border border-border bg-muted px-1">Esc</kbd> cancel
        </div>
      </div>
    </div>
  );
}
