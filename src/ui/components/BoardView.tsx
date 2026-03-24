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

    const cards = container.querySelectorAll(".issue-card:not(.dragging)");
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
    return <div className="loading">Loading board...</div>;
  }

  return (
    <div className="board">
      <div className="board-filters">
        <div className="search-wrapper">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="board-search"
            autoComplete="off"
          />
          <kbd className="kbd-hint">/</kbd>
        </div>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="position">Position</option>
          <option value="createdAt">Created</option>
          <option value="updatedAt">Updated</option>
        </select>
        <button
          className={`select-toggle ${selectionMode ? "active" : ""}`}
          onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
        >
          {selectionMode ? "Cancel" : "Select"}
        </button>
      </div>
      {workspaceStatuses && (
        <WorkspaceStatusFilters workspaceStatuses={workspaceStatuses} selected={filterWsStatuses} onSelectedChange={setFilterWsStatuses} />
      )}

      {/* Mobile: column tabs */}
      <div className="column-tabs">
        {visibleColumns.map((col, idx) => {
          const count = (issuesByColumn.get(col.name) ?? []).length;
          return (
            <button
              key={col._id}
              className={`column-tab ${idx === activeColumnIdx ? "active" : ""}`}
              onClick={() => setActiveColumnIdx(idx)}
            >
              {col.name}
              <span className="column-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="board-columns" data-testid="board-columns">
        {visibleColumns.map((col, idx) => {
          const colIssues = issuesByColumn.get(col.name) ?? [];
          const isActive = idx === activeColumnIdx;
          const isDragOver = dropTarget?.columnName === col.name;
          return (
            <div
              key={col._id}
              className={`board-column ${!isActive ? "mobile-hidden" : ""} ${isDragOver ? "drag-over" : ""}`}
              onDragOver={(e) => handleDragOver(e, col.name)}
              onDragLeave={(e) => handleDragLeave(e, col.name)}
              onDrop={() => handleDrop(col.name)}
            >
              <div className="column-header" style={{ borderTopColor: col.color }}>
                <div className="column-header-color" style={{ backgroundColor: col.color }} />
                <span className="column-name" data-testid="column-name">
                  {col.name}
                </span>
                <span className="column-count">{colIssues.length}</span>
                {selectionMode && (
                  <button
                    className="btn btn-sm"
                    onClick={() => selectAllInColumn(col.name)}
                    style={{ marginLeft: "auto", marginRight: 4 }}
                  >
                    All
                  </button>
                )}
                {(TERMINAL_COLUMN_NAMES as readonly string[]).includes(col.name) && colIssues.length > 0 && (
                  <button
                    type="button"
                    data-testid="column-archive-btn"
                    className="column-add-btn"
                    onClick={() => bulkArchive({ ids: colIssues.map((i) => i._id) })}
                    title={`Archive all ${col.name} issues`}
                    style={{ fontSize: "0.7rem", marginRight: 2 }}
                  >
                    Archive
                  </button>
                )}
                {(CREATABLE_COLUMNS as readonly string[]).includes(col.name) && (
                <button
                  type="button"
                  data-testid="column-add-btn"
                  className="column-add-btn"
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
              <div
                className="column-issues"
                ref={(el) => setColumnRef(col.name, el)}
              >
                {colIssues.map((issue, i) => {
                  const globalIdx = allVisibleIds.indexOf(issue._id);
                  return (
                  <div key={issue._id}>
                    {isDragOver && dropTarget.index === i && (
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
                {/* Drop indicator at the end of the list */}
                {isDragOver && dropTarget.index >= colIssues.length && (
                  <div className="drop-indicator" />
                )}
                {/* Empty column drop zone */}
                {colIssues.length === 0 && isDragOver && (
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
          className="fab"
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
