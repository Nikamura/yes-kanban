import { useState, useEffect, useRef } from "react";

const PRIORITIES = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

interface QuickActionPopoverProps {
  mode: "move" | "priority";
  columns: string[];
  currentStatus?: string;
  currentPriority?: string;
  onMove: (status: string) => void;
  onSetPriority: (priority: string) => void;
  onClose: () => void;
}

export function QuickActionPopover({
  mode,
  columns,
  currentStatus,
  currentPriority,
  onMove,
  onSetPriority,
  onClose,
}: QuickActionPopoverProps) {
  const items =
    mode === "move"
      ? columns.map((c) => ({ value: c, label: c }))
      : PRIORITIES.map((p) => ({ ...p }));

  const currentValue = mode === "move" ? currentStatus : currentPriority;
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = items.findIndex((i) => i.value === currentValue);
    return idx >= 0 ? idx : 0;
  });

  // Use refs to avoid re-registering the capture-phase listener on every render
  const stateRef = useRef({ items, selectedIndex, mode, onMove, onSetPriority, onClose });
  useEffect(() => {
    stateRef.current = { items, selectedIndex, mode, onMove, onSetPriority, onClose };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { items: itms, selectedIndex: idx, mode: m, onMove: mv, onSetPriority: sp, onClose: cl } = stateRef.current;
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
          if (item) {
            if (m === "move") mv(item.value);
            else sp(item.value);
          }
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
    if (mode === "move") onMove(value);
    else onSetPriority(value);
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog quick-action-popover"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 280 }}
      >
        <h3>{mode === "move" ? "Move to column" : "Set priority"}</h3>
        <div className="quick-action-list">
          {items.map((item, i) => (
            <button
              key={item.value}
              className={`quick-action-item ${i === selectedIndex ? "selected" : ""} ${item.value === currentValue ? "current" : ""}`}
              onClick={() => handleSelect(item.value)}
            >
              {item.label}
              {item.value === currentValue && (
                <span className="quick-action-current-badge">current</span>
              )}
            </button>
          ))}
        </div>
        <div className="quick-action-hint">
          <kbd>j</kbd>/<kbd>k</kbd> navigate &middot; <kbd>Enter</kbd> select &middot; <kbd>Esc</kbd> cancel
        </div>
      </div>
    </div>
  );
}
