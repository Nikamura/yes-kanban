import { useCallback, useMemo } from "react";

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
    <div className="ws-status-filters">
      {availableStatuses.map((status) => (
        <button
          key={status}
          className={`ws-status ws-status-${status} ws-status-filter${selected.has(status) ? " active" : ""}`}
          onClick={() => toggle(status)}
        >
          {status}
        </button>
      ))}
      {selected.size > 0 && (
        <button className="ws-status-filter-clear" onClick={() => onSelectedChange(new Set())}>
          &times;
        </button>
      )}
    </div>
  );
}
