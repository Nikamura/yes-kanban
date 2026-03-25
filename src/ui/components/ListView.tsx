import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useRef } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { filterIssues, sortIssues, type SortKey } from "../boardFilters";
import { BulkActionBar } from "./BulkActionBar";
import { WorkspaceStatusFilters } from "./WorkspaceStatusFilters";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { Badge } from "@/ui/components/ui/badge";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { cn } from "@/ui/lib/utils";

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

  if (!issues || !columns) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading...
      </div>
    );
  }

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

  const checkboxClass = (checked: boolean) =>
    cn(
      "flex size-5 shrink-0 items-center justify-center rounded border-2 border-border bg-transparent transition-colors",
      checked && "border-primary bg-primary text-primary-foreground",
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="list-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/30 px-3 py-2">
        <Input
          type="text"
          placeholder="Search issues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-11 max-w-[min(100%,280px)] flex-1 md:min-h-9"
          autoComplete="off"
        />
        <select
          data-testid="list-status-filter"
          className="min-h-11 rounded-md border border-input bg-background px-2 py-1.5 text-sm md:min-h-9"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          {colNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant={selectionMode ? "default" : "outline"}
          size="sm"
          className="min-h-11 rounded-md md:min-h-9"
          onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
        >
          {selectionMode ? "Cancel" : "Select"}
        </Button>
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="list-count">
          {sorted.length} issues
        </span>
      </div>
      {workspaceStatuses && (
        <WorkspaceStatusFilters workspaceStatuses={workspaceStatuses} selected={filterWsStatuses} onSelectedChange={setFilterWsStatuses} />
      )}

      {/* Mobile: card list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 md:hidden">
        {sorted.map((issue) => (
          <div
            key={issue._id}
            className={cn(
              "rounded-md border border-border bg-card p-3",
              selectedIds.has(issue._id) && "ring-2 ring-primary",
            )}
            onClick={(e) => (selectionMode ? toggleSelect(issue._id, e.shiftKey) : onOpenIssue(issue.simpleId))}
          >
            <div className="flex gap-2">
              {selectionMode && (
                <div
                  className={cn(checkboxClass(selectedIds.has(issue._id)))}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(issue._id, e.shiftKey);
                  }}
                >
                  {selectedIds.has(issue._id) ? "✓" : null}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{issue.simpleId}</span>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {issue.status}
                  </Badge>
                </div>
                <div className="font-medium">{issue.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {issue.tags.map((t) => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]" data-testid="issue-tag">
                      {t}
                    </span>
                  ))}
                  <span>{new Date(issue.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full border-collapse text-left text-sm" data-testid="list-table">
          <thead className="sticky top-0 z-[1] border-b border-border bg-card">
            <tr>
              {selectionMode && <th className="w-10 p-2" />}
              <th className="cursor-pointer p-2 font-mono text-xs hover:bg-muted/50" onClick={() => toggleSort("simpleId")}>
                ID {sortKey === "simpleId" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th className="cursor-pointer p-2 hover:bg-muted/50" onClick={() => toggleSort("title")}>
                Title {sortKey === "title" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th className="cursor-pointer p-2 hover:bg-muted/50" onClick={() => toggleSort("status")}>
                Status {sortKey === "status" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th className="p-2">Tags</th>
              <th className="cursor-pointer p-2 hover:bg-muted/50" onClick={() => toggleSort("createdAt")}>
                Created {sortKey === "createdAt" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((issue) => (
              <tr
                key={issue._id}
                className={cn(
                  "border-b border-border hover:bg-muted/30",
                  selectedIds.has(issue._id) && "bg-primary/5",
                )}
                onClick={(e) => (selectionMode ? toggleSelect(issue._id, e.shiftKey) : onOpenIssue(issue.simpleId))}
                style={{ cursor: selectionMode ? undefined : "pointer" }}
              >
                {selectionMode && (
                  <td className="p-2">
                    <div
                      className={cn(checkboxClass(selectedIds.has(issue._id)))}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(issue._id, e.shiftKey);
                      }}
                    >
                      {selectedIds.has(issue._id) ? "✓" : null}
                    </div>
                  </td>
                )}
                <td className="p-2 font-mono text-xs">{issue.simpleId}</td>
                <td className="p-2">{issue.title}</td>
                <td className="p-2">
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {issue.status}
                  </Badge>
                </td>
                <td className="p-2">
                  {issue.tags.map((t) => (
                    <span key={t} className="mr-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]" data-testid="issue-tag">
                      {t}
                    </span>
                  ))}
                </td>
                <td className="p-2 text-muted-foreground">{new Date(issue.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
