import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";

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
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-8 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading archive...
      </div>
    );
  }

  const filtered = search
    ? issues.filter((i) => {
        const s = search.toLowerCase();
        // description is optional at runtime for some client/query shapes; keep search crash-safe.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
        return [i.title, i.description ?? "", i.simpleId].some((field) =>
          field.toLowerCase().includes(s),
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Archive</h2>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:max-w-md">
          <Input
            type="text"
            placeholder="Search archived issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[120px] flex-1"
            autoComplete="off"
          />
          {selectedIds.size > 0 && (
            <Button size="sm" onClick={handleBulkRestore}>
              Restore {selectedIds.size} selected
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
          <p>{search ? "No archived issues match your search." : "No archived issues."}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-[1] border-b border-border bg-card">
              <tr>
                <th className="w-10 p-2">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="p-2">ID</th>
                <th className="p-2">Title</th>
                <th className="p-2">Status</th>
                <th className="p-2">Archived</th>
                <th className="w-24 p-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue) => (
                <tr
                  key={issue._id}
                  className="border-b border-border hover:bg-muted/30"
                  onClick={() => onOpenIssue(issue.simpleId)}
                  style={{ cursor: "pointer" }}
                >
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input"
                      checked={selectedIds.has(issue._id)}
                      onChange={() => toggleSelect(issue._id)}
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{issue.simpleId}</td>
                  <td className="p-2">{issue.title}</td>
                  <td className="p-2">{issue.status}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {issue.archivedAt
                      ? new Date(issue.archivedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => handleRestore(issue._id)}>
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
