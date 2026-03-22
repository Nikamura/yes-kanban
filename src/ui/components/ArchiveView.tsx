import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { IssueDetailPanel } from "./IssueDetailPanel";

interface ArchiveViewProps {
  projectId: Id<"projects">;
  activeIssueSimpleId: string | null;
  activeWorkspaceId: string | null;
  onOpenIssue: (simpleId: string) => void;
  onCloseIssue: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onCloseWorkspace: () => void;
}

export function ArchiveView({ projectId, activeIssueSimpleId, activeWorkspaceId, onOpenIssue, onCloseIssue, onOpenWorkspace, onCloseWorkspace }: ArchiveViewProps) {
  const issues = useQuery(api.issues.list, { projectId, archived: true });
  const unarchive = useMutation(api.issues.unarchive);
  const bulkUnarchive = useMutation(api.bulkIssues.bulkUnarchive);

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<Id<"issues">>>(new Set());

  if (!issues) {
    return <div className="loading">Loading archive...</div>;
  }

  const filtered = search
    ? issues.filter((i) => {
        const s = search.toLowerCase();
        return (
          i.title.toLowerCase().includes(s) ||
          i.description.toLowerCase().includes(s) ||
          i.simpleId.toLowerCase().includes(s)
        );
      })
    : issues;

  const toggleSelect = (id: Id<"issues">) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((i) => i._id)));
    }
  };

  const handleRestore = async (id: Id<"issues">) => {
    await unarchive({ id });
  };

  const handleBulkRestore = async () => {
    await bulkUnarchive({ ids: [...selectedIds] });
    setSelectedIds(new Set());
  };

  return (
    <div className="archive-view">
      <div className="archive-header">
        <h2>Archive</h2>
        <div className="archive-controls">
          <input
            type="text"
            placeholder="Search archived issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="board-search"
            autoComplete="off"
          />
          {selectedIds.size > 0 && (
            <button className="btn btn-primary btn-sm" onClick={handleBulkRestore}>
              Restore {selectedIds.size} selected
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>{search ? "No archived issues match your search." : "No archived issues."}</p>
        </div>
      ) : (
        <table className="archive-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>ID</th>
              <th>Title</th>
              <th>Status</th>
              <th>Archived</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((issue) => (
              <tr
                key={issue._id}
                onClick={() => onOpenIssue(issue.simpleId)}
                style={{ cursor: "pointer" }}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(issue._id)}
                    onChange={() => toggleSelect(issue._id)}
                  />
                </td>
                <td className="issue-id">{issue.simpleId}</td>
                <td>{issue.title}</td>
                <td>{issue.status}</td>
                <td className="archive-date">
                  {issue.archivedAt
                    ? new Date(issue.archivedAt).toLocaleDateString()
                    : "—"}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleRestore(issue._id)}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeIssueSimpleId && (() => {
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
