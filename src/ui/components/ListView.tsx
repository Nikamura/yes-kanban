import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useRef } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { filterIssues, sortIssues, type SortKey } from "../boardFilters";
import { BulkActionBar } from "./BulkActionBar";
import { WorkspaceStatusFilters } from "./WorkspaceStatusFilters";
import { IssueDetailPanel } from "./IssueDetailPanel";

interface ListViewProps {
  projectId: Id<"projects">;
  activeIssueSimpleId: string | null;
  activeWorkspaceId: string | null;
  onOpenIssue: (simpleId: string) => void;
  onCloseIssue: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onCloseWorkspace: () => void;
}

export function ListView({ projectId, activeIssueSimpleId, activeWorkspaceId, onOpenIssue, onCloseIssue, onOpenWorkspace, onCloseWorkspace }: ListViewProps) {
  const issues = useQuery(api.issues.list, { projectId });
  const columns = useQuery(api.columns.list, { projectId });
  const workspaceStatuses = useQuery(api.workspaces.latestByProject, { projectId });

  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterWsStatuses, setFilterWsStatuses] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<Id<"issues">>>(new Set());
  const lastClickedId = useRef<Id<"issues"> | null>(null);

  if (!issues || !columns) return <div className="loading">Loading...</div>;

  const filtered = filterIssues(issues, { search, filterStatus, searchDescription: true, filterWorkspaceStatuses: filterWsStatuses, workspaceStatuses: workspaceStatuses ?? undefined });
  const sorted = [...filtered].sort(sortIssues(sortKey, sortAsc));

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const toggleSelect = (id: Id<"issues">, shiftKey = false) => {
    if (shiftKey && lastClickedId.current && lastClickedId.current !== id) {
      const sortedIds = sorted.map((i) => i._id);
      const startIdx = sortedIds.indexOf(lastClickedId.current);
      const endIdx = sortedIds.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            const issueId = sortedIds[i];
            if (issueId) next.add(issueId);
          }
          return next;
        });
        lastClickedId.current = id;
        return;
      }
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClickedId.current = id;
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const colNames = columns.map((c) => c.name);

  return (
    <div className="list-view">
      <div className="list-filters">
        <input
          type="text"
          placeholder="Search issues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="list-search"
          autoComplete="off"
        />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {colNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          className={`select-toggle ${selectionMode ? "active" : ""}`}
          onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
        >
          {selectionMode ? "Cancel" : "Select"}
        </button>
        <span className="list-count">{sorted.length} issues</span>
      </div>
      {workspaceStatuses && (
        <WorkspaceStatusFilters workspaceStatuses={workspaceStatuses} selected={filterWsStatuses} onSelectedChange={setFilterWsStatuses} />
      )}

      {/* Mobile: card list */}
      <div className="list-cards">
        {sorted.map((issue) => (
          <div
            key={issue._id}
            className={`list-card ${selectedIds.has(issue._id) ? "selected" : ""}`}
            onClick={(e) => selectionMode ? toggleSelect(issue._id, e.shiftKey) : onOpenIssue(issue.simpleId)}
          >
            {selectionMode && (
              <div
                className={`issue-card-checkbox ${selectedIds.has(issue._id) ? "checked" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(issue._id, e.shiftKey);
                }}
              />
            )}
            <div className="issue-card-priority-strip" />
            <div className="list-card-content">
              <div className="list-card-header">
                <span className="issue-id">{issue.simpleId}</span>
                <span className="status-badge">{issue.status}</span>
              </div>
              <div className="list-card-title">{issue.title}</div>
              <div className="list-card-meta">
                {issue.tags.map((t) => (
                  <span key={t} className="issue-tag">{t}</span>
                ))}
                <span className="date-cell">
                  {new Date(issue.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <table className="list-table">
        <thead>
          <tr>
            {selectionMode && <th className="select-col" />}
            <th onClick={() => toggleSort("simpleId")} className="sortable">
              ID {sortKey === "simpleId" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            <th onClick={() => toggleSort("title")} className="sortable">
              Title {sortKey === "title" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            <th onClick={() => toggleSort("status")} className="sortable">
              Status {sortKey === "status" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            <th>Tags</th>
            <th onClick={() => toggleSort("createdAt")} className="sortable">
              Created {sortKey === "createdAt" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((issue) => (
            <tr
              key={issue._id}
              className={selectedIds.has(issue._id) ? "selected" : ""}
              onClick={(e) => selectionMode ? toggleSelect(issue._id, e.shiftKey) : onOpenIssue(issue.simpleId)}
              style={{ cursor: selectionMode ? undefined : "pointer" }}
            >
              {selectionMode && (
                <td>
                  <div
                    className={`issue-card-checkbox ${selectedIds.has(issue._id) ? "checked" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(issue._id, e.shiftKey);
                    }}
                  />
                </td>
              )}
              <td className="issue-id">{issue.simpleId}</td>
              <td>{issue.title}</td>
              <td>
                <span className="status-badge">{issue.status}</span>
              </td>
              <td>
                {issue.tags.map((t) => (
                  <span key={t} className="issue-tag">
                    {t}
                  </span>
                ))}
              </td>
              <td className="date-cell">{new Date(issue.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <BulkActionBar
        projectId={projectId}
        selectedIds={selectedIds}
        onClearSelection={exitSelectionMode}
      />

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
    </div>
  );
}
