import { useCallback, useMemo } from "react";
import { cn } from "@/ui/lib/utils";
import { wsStatusBadgeClass, wsStatusStyle } from "@/ui/lib/wsStatusColors";

interface WorkspaceStatusFiltersProps {
  workspaceStatuses: Record<string, { status: string }>;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}

export function WorkspaceStatusFilters({ workspaceStatuses, selected, onSelectedChange }: WorkspaceStatusFiltersProps) {
  const availableStatuses = useMemo(
    () => [...new Set(Object.values(workspaceStatuses).map((ws) => ws.status))].sort(),
    [workspaceStatuses]
  );

  const toggle = useCallback(
    (status: string) => {
      const next = new Set(selected);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      onSelectedChange(next);
    },
    [selected, onSelectedChange]
  );

  if (availableStatuses.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
      {availableStatuses.map((status) => {
        const isOn = selected.has(status);
        return (
          <button
            key={status}
            type="button"
            className={cn(
              wsStatusBadgeClass,
              "cursor-pointer border opacity-50 transition-opacity hover:opacity-80",
              isOn && "border-current opacity-100",
            )}
            style={wsStatusStyle(status)}
            onClick={() => toggle(status)}
          >
            {status}
          </button>
        );
      })}
      {selected.size > 0 && (
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0.5 text-base leading-none text-muted-foreground hover:text-foreground"
          onClick={() => onSelectedChange(new Set())}
        >
          &times;
        </button>
      )}
    </div>
  );
}
