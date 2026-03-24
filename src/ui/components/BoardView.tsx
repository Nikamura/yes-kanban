import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useRef, useCallback } from "react";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { IssueCard } from "./IssueCard";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { BulkActionBar } from "./BulkActionBar";
import { filterIssues, sortIssues, type SortKey } from "../boardFilters";
import { CREATABLE_COLUMNS, TERMINAL_COLUMN_NAMES } from "../utils/constants";
import { WorkspaceStatusFilters } from "./WorkspaceStatusFilters";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { ShortcutsHelpModal } from "./ShortcutsHelpModal";
import { QuickActionPopover } from "./QuickActionPopover";
import { CommandPalette } from "./CommandPalette";
import { cn } from "@/ui/lib/utils";
import { Button } from "@/ui/components/ui/button";

interface DropTarget {
  columnName: string;
  index: number; // index in the column's issue list where to insert
}

interface BoardViewProps {
  projectId: Id<"projects">;
  activeIssueSimpleId: string | null;
  activeWorkspaceId: string | null;
  onOpenIssue: (simpleId: string) => void;
  onCloseIssue: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onCloseWorkspace: () => void;
}

export function BoardView({ projectId, activeIssueSimpleId, activeWorkspaceId, onOpenIssue, onCloseIssue, onOpenWorkspace, onCloseWorkspace }: BoardViewProps) {
  const columns = useQuery(api.columns.list, { projectId });
  const issues = useQuery(api.issues.list, { projectId });
  const workspaceStatuses = useQuery(api.workspaces.latestByProject, { projectId });
  const moveIssue = useMutation(api.issues.move);
  const bulkArchive = useMutation(api.bulkIssues.bulkArchive);

  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [createInColumn, setCreateInColumn] = useState<string>("To Do");
  const [draggedIssue, setDraggedIssue] = useState<Id<"issues"> | null>(null);
  const [search, setSearch] = useState("");
  const [filterWsStatuses, setFilterWsStatuses] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("position");

  // Drop target tracking
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Mobile: active column tab
  const [activeColumnIdx, setActiveColumnIdx] = useState(0);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<Id<"issues">>>(new Set());

  // Shift-select: track last clicked issue for range selection
  const lastClickedId = useRef<Id<"issues"> | null>(null);

  // Long-press detection
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for column issue containers (for calculating drop position)
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setColumnRef = useCallback((name: string, el: HTMLDivElement | null) => {
    if (el) columnRefs.current.set(name, el);
    else columnRefs.current.delete(name);
  }, []);

  // Keyboard focus tracking (must be before early return)
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [quickMoveOpen, setQuickMoveOpen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset focus when filters change (using state-during-render pattern like the project resolver)
  const filterKey = `${search}|${sortKey}|${[...filterWsStatuses].sort().join(",")}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setFocusedIndex(-1);
  }

  // Compute derived data before hooks that depend on it
  const filtered = columns && issues ? filterIssues(issues, { search, filterWorkspaceStatuses: filterWsStatuses, workspaceStatuses: workspaceStatuses ?? undefined }) : [];
  const visibleColumns = columns?.filter((c) => c.visible) ?? [];

  const issuesByColumn = new Map<string, Doc<"issues">[]>();
  if (columns) {
    for (const col of columns) {
      issuesByColumn.set(col.name, []);
    }
    for (const issue of filtered) {
      const list = issuesByColumn.get(issue.status);
      if (list) list.push(issue);
    }
    for (const [, list] of issuesByColumn) {
      list.sort(sortIssues(sortKey));
    }
  }

  // Build flat ordered list of all visible issue IDs (column by column)
  const allVisibleIds: Id<"issues">[] = [];
  for (const col of visibleColumns) {
    const colIssues = issuesByColumn.get(col.name) ?? [];
    for (const issue of colIssues) allVisibleIds.push(issue._id);
  }

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNewIssue: () => {
      if (activeIssueSimpleId || showCreateIssue) return;
      const col = visibleColumns[activeColumnIdx] ?? visibleColumns[0];
      if (col) {
        setCreateInColumn(
          (CREATABLE_COLUMNS as readonly string[]).includes(col.name) ? col.name : "Backlog",
        );
      }
      setShowCreateIssue(true);
    },
    onNavigateDown: () => {
      if (activeIssueSimpleId) return;
      setFocusedIndex((prev) => Math.min(prev + 1, allVisibleIds.length - 1));
    },
    onNavigateUp: () => {
      if (activeIssueSimpleId) return;
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    },
    onOpenFocused: () => {
      if (activeIssueSimpleId || focusedIndex < 0 || !issues || allVisibleIds.length === 0) return;
      const idx = Math.min(focusedIndex, allVisibleIds.length - 1);
      const id = allVisibleIds[idx];
      if (!id) return;
      const issue = issues.find((i) => i._id === id);
      if (issue) onOpenIssue(issue.simpleId);
    },
    onSwitchColumn: (index: number) => {
      if (index < visibleColumns.length) setActiveColumnIdx(index);
    },
    onFocusSearch: () => searchRef.current?.focus(),
    onShowHelp: () => setShowShortcutsHelp(true),
    onMoveFocused: () => {
      if (effectiveFocusedIndex < 0) return;
      setQuickMoveOpen(true);
    },
    onCommandPalette: () => setShowCommandPalette((prev) => !prev),
  });

  const calcDropIndex = (columnName: string, clientY: number): number => {
    const container = columnRefs.current.get(columnName);
    if (!container) return 0;

    const cards = container.querySelectorAll('[data-issue-card]:not([data-dragging="true"])');
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!card) continue;
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return i;
    }
    return cards.length;
  };

  const handleDragOver = (e: React.DragEvent, columnName: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const index = calcDropIndex(columnName, e.clientY);
    setDropTarget((prev) => {
      if (prev?.columnName === columnName && prev.index === index) return prev;
      return { columnName, index };
    });
  };

  const handleDragLeave = (e: React.DragEvent, columnName: string) => {
    // Only clear if actually leaving the column (not entering a child)
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as Node;
    if (relatedTarget && currentTarget.contains(relatedTarget)) return;
    setDropTarget((prev) => (prev?.columnName === columnName ? null : prev));
  };

  const handleDrop = async (columnName: string) => {
    if (!draggedIssue) return;
    const colIssues = issuesByColumn.get(columnName) ?? [];
    const targetIndex = dropTarget?.columnName === columnName ? dropTarget.index : colIssues.length;

    // Calculate the position value for insertion at targetIndex
    let position: number;
    if (colIssues.length === 0) {
      position = 0;
    } else if (targetIndex === 0) {
      position = (colIssues[0]?.position ?? 0) - 1;
    } else if (targetIndex >= colIssues.length) {
      position = (colIssues[colIssues.length - 1]?.position ?? 0) + 1;
    } else {
      const before = colIssues[targetIndex - 1]?.position ?? 0;
      const after = colIssues[targetIndex]?.position ?? 0;
      position = (before + after) / 2;
    }

    await moveIssue({ id: draggedIssue, status: columnName, position });
    setDraggedIssue(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggedIssue(null);
    setDropTarget(null);
  };

  const toggleSelect = (id: Id<"issues">, shiftKey = false) => {
    if (shiftKey && lastClickedId.current && lastClickedId.current !== id) {
      // Range select: select everything between lastClicked and current
      const startIdx = allVisibleIds.indexOf(lastClickedId.current);
      const endIdx = allVisibleIds.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            const issueId = allVisibleIds[i];
            if (issueId) next.add(issueId);
          }
          return next;
        });
        lastClickedId.current = id;
        return;
      }
    }

    // Normal toggle
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClickedId.current = id;
  };

  const handleCardClick = (issue: { _id: Id<"issues">; simpleId: string }, e?: React.MouseEvent) => {
    if (selectionMode) {
      toggleSelect(issue._id, e?.shiftKey);
    } else {
      onOpenIssue(issue.simpleId);
    }
  };

  const handleLongPressStart = (id: Id<"issues">) => {
    longPressTimer.current = setTimeout(() => {
      setSelectionMode(true);
      setSelectedIds(new Set([id]));
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectAllInColumn = (columnName: string) => {
    const colIssues = issuesByColumn.get(columnName) ?? [];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const issue of colIssues) next.add(issue._id);
      return next;
    });
    if (!selectionMode) setSelectionMode(true);
  };

  // Clamp focusedIndex — use clamped value directly instead of setState during render
  const effectiveFocusedIndex = allVisibleIds.length > 0
    ? Math.min(focusedIndex, allVisibleIds.length - 1)
    : -1;


  const focusedIssueId = effectiveFocusedIndex >= 0 ? allVisibleIds[effectiveFocusedIndex] : undefined;
  const focusedIssue = focusedIssueId ? issues?.find((i) => i._id === focusedIssueId) : undefined;

  const handleQuickMove = async (status: string) => {
    if (!focusedIssue) return;
    const colIssues = issuesByColumn.get(status) ?? [];
    const position = colIssues.length > 0 ? (colIssues[colIssues.length - 1]?.position ?? 0) + 1 : 0;
    await moveIssue({ id: focusedIssue._id, status, position });
  };

  const activeColumn = visibleColumns[activeColumnIdx] ?? visibleColumns[0];

  if (!columns || !issues) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground animate-in fade-in duration-300">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden />
        <span>Loading board...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3 lg:flex-nowrap lg:px-5">
        <div className="relative min-w-[120px] flex-1">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-secondary px-3 py-2 pr-8 text-sm text-foreground outline-none focus:border-primary lg:min-h-0"
            autoComplete="off"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-muted px-1 py-px font-sans text-[0.7rem] text-muted-foreground">
            /
          </kbd>
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="min-h-11 rounded-md border border-border bg-secondary px-2 py-2 text-sm lg:min-h-0"
        >
          <option value="position">Position</option>
          <option value="createdAt">Created</option>
          <option value="updatedAt">Updated</option>
        </select>
        <button
          type="button"
          className={cn(
            "min-h-11 cursor-pointer rounded-md border border-border px-3 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground",
            selectionMode && "border-primary bg-primary/10 text-primary",
          )}
          onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
        >
          {selectionMode ? "Cancel" : "Select"}
        </button>
      </div>
      {workspaceStatuses && (
        <WorkspaceStatusFilters workspaceStatuses={workspaceStatuses} selected={filterWsStatuses} onSelectedChange={setFilterWsStatuses} />
      )}

      {/* Mobile: column tabs */}
      <div className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {visibleColumns.map((col, idx) => {
          const count = (issuesByColumn.get(col.name) ?? []).length;
          return (
            <button
              key={col._id}
              type="button"
              className={cn(
                "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 font-mono text-[11px] font-medium whitespace-nowrap transition-colors",
                idx === activeColumnIdx
                  ? "border-primary bg-primary text-white shadow-[0_0_20px_rgba(37,99,235,0.15)]"
                  : "border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground",
              )}
              onClick={() => setActiveColumnIdx(idx)}
            >
              {col.name}
              <span
                className={cn(
                  "rounded-lg px-1.5 py-px text-[10px]",
                  idx === activeColumnIdx ? "bg-white/30" : "bg-white/20",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 lg:flex-row lg:gap-3 lg:overflow-x-auto lg:overflow-y-hidden lg:px-5 lg:pb-5"
        data-testid="board-columns"
      >
        {visibleColumns.map((col, idx) => {
          const colIssues = issuesByColumn.get(col.name) ?? [];
          const isActive = idx === activeColumnIdx;
          const isDragOver = dropTarget?.columnName === col.name;
          const showEndIndicator =
            isDragOver && dropTarget !== null && (dropTarget.index >= colIssues.length || colIssues.length === 0);
          return (
            <div
              key={col._id}
              className={cn(
                "flex w-full flex-col",
                !isActive && "hidden lg:flex",
                isDragOver && "rounded-lg bg-primary/10 lg:bg-card lg:shadow-[0_0_20px_rgba(37,99,235,0.15)]",
                "lg:min-h-0 lg:min-w-[260px] lg:max-w-[360px] lg:flex-1 lg:overflow-hidden lg:rounded-lg lg:border lg:border-border lg:bg-card",
              )}
              onDragOver={(e) => handleDragOver(e, col.name)}
              onDragLeave={(e) => handleDragLeave(e, col.name)}
              onDrop={() => handleDrop(col.name)}
            >
              <div
                className="flex items-center gap-2 border-t-0 py-3 font-semibold text-[13px] lg:border-t-[3px] lg:border-solid lg:px-3 lg:pt-3.5 lg:pb-2.5"
                style={{ borderTopColor: col.color }}
              >
                <div className="h-5 w-1 shrink-0 rounded-sm lg:hidden" style={{ backgroundColor: col.color }} />
                <span className="font-mono text-xs font-semibold tracking-wide uppercase" data-testid="column-name">
                  {col.name}
                </span>
                <span className="rounded-[10px] bg-muted px-2 py-px font-mono text-[11px] text-muted-foreground">
                  {colIssues.length}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {selectionMode && (
                    <Button variant="outline" size="sm" onClick={() => selectAllInColumn(col.name)}>
                      All
                    </Button>
                  )}
                  {(TERMINAL_COLUMN_NAMES as readonly string[]).includes(col.name) && colIssues.length > 0 && (
                    <button
                      type="button"
                      data-testid="column-archive-btn"
                      className="flex h-10 min-w-[4.5rem] items-center justify-center rounded-md px-1 text-[0.7rem] text-muted-foreground hover:bg-muted hover:text-foreground lg:h-7"
                      onClick={() => bulkArchive({ ids: colIssues.map((i) => i._id) })}
                      title={`Archive all ${col.name} issues`}
                    >
                      Archive
                    </button>
                  )}
                  {(CREATABLE_COLUMNS as readonly string[]).includes(col.name) && (
                    <button
                      type="button"
                      data-testid="column-add-btn"
                      className="flex h-11 w-11 items-center justify-center rounded-md text-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:h-7 lg:w-7"
                      onClick={() => {
                        setCreateInColumn(col.name);
                        setShowCreateIssue(true);
                      }}
                      title="Add issue (c)"
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
              <div
                className="flex min-h-10 flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-2"
                ref={(el) => setColumnRef(col.name, el)}
              >
                {colIssues.map((issue, i) => {
                  const globalIdx = allVisibleIds.indexOf(issue._id);
                  return (
                  <div key={issue._id}>
                    {isDragOver && dropTarget?.index === i && (
                      <div className="drop-indicator" />
                    )}
                    <IssueCard
                      issue={issue}
                      focused={globalIdx === effectiveFocusedIndex}
                      workspaceStatus={workspaceStatuses?.[issue._id]?.status}
                      behindMainBy={workspaceStatuses?.[issue._id]?.behindMainBy}
                      isDragging={draggedIssue === issue._id}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(issue._id)}
                      onClick={(e) => handleCardClick(issue, e)}
                      onToggleSelect={(e) => toggleSelect(issue._id, e.shiftKey)}
                      onDragStart={() => setDraggedIssue(issue._id)}
                      onDragEnd={handleDragEnd}
                      onLongPressStart={() => handleLongPressStart(issue._id)}
                      onLongPressEnd={handleLongPressEnd}
                      onStatusClick={workspaceStatuses?.[issue._id]?.workspaceId ? () => {
                        onOpenIssue(issue.simpleId);
                        const ws = workspaceStatuses[issue._id];
                        if (ws) onOpenWorkspace(ws.workspaceId);
                      } : undefined}
                    />
                  </div>
                  );
                })}
                {showEndIndicator && (
                  <div className="drop-indicator" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile FAB */}
      {!selectionMode && (
        <button
          type="button"
          className="fixed right-4 bottom-[68px] z-[80] flex h-14 w-14 items-center justify-center rounded-2xl border-0 bg-primary text-2xl text-white shadow-[0_4px_16px_rgba(37,99,235,0.4),0_0_20px_rgba(37,99,235,0.15)] transition-transform hover:scale-105 active:scale-95 lg:hidden"
          onClick={() => {
            if (activeColumn) {
              setCreateInColumn(
                (CREATABLE_COLUMNS as readonly string[]).includes(activeColumn.name)
                  ? activeColumn.name
                  : "Backlog",
              );
            }
            setShowCreateIssue(true);
          }}
          title="Add issue"
        >
          +
        </button>
      )}

      {showCreateIssue && (
        <CreateIssueDialog
          projectId={projectId}
          defaultStatus={createInColumn}
          onClose={() => setShowCreateIssue(false)}
        />
      )}

      {activeIssueSimpleId && !selectionMode && (() => {
        const matchedIssue = issues.find((i) => i.simpleId === activeIssueSimpleId);
        if (!matchedIssue) return null;
        return (
          <IssueDetailPanel
            issueId={matchedIssue._id}
            onClose={onCloseIssue}
            activeWorkspaceId={activeWorkspaceId}
            onOpenWorkspace={onOpenWorkspace}
            onCloseWorkspace={onCloseWorkspace}
          />
        );
      })()}

      <BulkActionBar
        projectId={projectId}
        selectedIds={selectedIds}
        onClearSelection={exitSelectionMode}
      />

      {showShortcutsHelp && (
        <ShortcutsHelpModal onClose={() => setShowShortcutsHelp(false)} />
      )}

      {quickMoveOpen && focusedIssue && (
        <QuickActionPopover
          columns={visibleColumns.map((c) => c.name)}
          currentStatus={focusedIssue.status}
          onMove={handleQuickMove}
          onClose={() => setQuickMoveOpen(false)}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          issues={issues}
          columns={visibleColumns.map((c) => c.name)}
          onClose={() => setShowCommandPalette(false)}
          onNewIssue={() => {
            const col = visibleColumns[activeColumnIdx] ?? visibleColumns[0];
            if (col) setCreateInColumn(col.name);
            setShowCreateIssue(true);
          }}
          onOpenIssue={onOpenIssue}
          onMoveFocused={() => { if (effectiveFocusedIndex >= 0) setQuickMoveOpen(true); }}
          onShowHelp={() => setShowShortcutsHelp(true)}
          onSwitchColumn={(index) => { if (index < visibleColumns.length) setActiveColumnIdx(index); }}
          onFocusSearch={() => searchRef.current?.focus()}
        />
      )}
    </div>
  );
}
