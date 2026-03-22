import { useState, useEffect, useRef } from "react";

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
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog quick-action-popover"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 280 }}
      >
        <h3>Move to column</h3>
        <div className="quick-action-list">
          {items.map((item, i) => (
            <button
              key={item.value}
              className={`quick-action-item ${i === selectedIndex ? "selected" : ""} ${item.value === currentStatus ? "current" : ""}`}
              onClick={() => handleSelect(item.value)}
            >
              {item.label}
              {item.value === currentStatus && (
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
