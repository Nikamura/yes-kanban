import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useMemo, useEffect } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { WorkspaceView } from "./WorkspaceView";
import { AttachmentsSection } from "./AttachmentsSection";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { ChecklistSection } from "./ChecklistSection";
import { formatHistoryEntry } from "../formatHistoryEntry";
import { TERMINAL_STATUSES } from "../utils/constants";
import { isSupportedAgentAdapterType } from "@/lib/agentTypes";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { Input } from "@/ui/components/ui/input";
import { Textarea } from "@/ui/components/ui/textarea";
import { cn } from "@/ui/lib/utils";
import { wsWorkspaceStatusClass } from "@/ui/lib/wsUi";

/** Markdown links in the description must not bubble to the click-to-edit wrapper. */
const issueDescriptionMarkdownComponents: Partial<Components> = {
  a: ({ node: _node, ...props }) => (
    <a {...props} onClick={(e) => e.stopPropagation()} />
  ),
};

export function IssueDetailPanel({
  issueId,
  onClose,
  activeWorkspaceId,
  onOpenWorkspace,
  onCloseWorkspace,
}: {
  issueId: Id<"issues">;
  onClose: () => void;
  activeWorkspaceId: string | null;
  onOpenWorkspace: (workspaceId: string) => void;
  onCloseWorkspace: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const issue = useQuery(api.issues.get, { id: issueId });
  const workspaces = useQuery(api.workspaces.listByIssue, { issueId });
  const comments = useQuery(api.comments.list, { issueId });
  const history = useQuery(api.issueHistory.list, showHistory ? { issueId } : "skip");
  const blockerIds = useMemo(() => issue?.blockedBy ?? [], [issue?.blockedBy]);
  const blockerIssues = useQuery(
    api.issues.getByIds,
    blockerIds.length > 0 ? { ids: blockerIds } : "skip"
  );
  const allProjectIssues = useQuery(
    api.issues.list,
    issue ? { projectId: issue.projectId } : "skip"
  );
  const columns = useQuery(api.columns.list, issue ? { projectId: issue.projectId } : "skip");
  const updateIssue = useMutation(api.issues.update);
  const moveIssue = useMutation(api.issues.move);
  const addComment = useMutation(api.comments.create);
  const removeIssue = useMutation(api.issues.remove);
  const archiveIssue = useMutation(api.issues.archive);
  const unarchiveIssue = useMutation(api.issues.unarchive);

  const agentConfigs = useQuery(api.agentConfigs.list, issue ? { projectId: issue.projectId } : "skip");
  const dispatchableAgentConfigs = useMemo(
    () =>
      agentConfigs?.filter((ac) => isSupportedAgentAdapterType(ac.agentType)) ?? [],
    [agentConfigs],
  );
  const createWorkspace = useMutation(api.workspaces.create);
  const removeWorkspace = useMutation(api.workspaces.remove);
  const abandonWorkspace = useMutation(api.workspaces.abandon);

  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [selectedAgentConfigId, setSelectedAgentConfigId] = useState<Id<"agentConfigs"> | null>(null);
  /** Selection is only valid if it points at a config the worker can run. */
  const effectiveAgentConfigId = useMemo(() => {
    if (!selectedAgentConfigId) return null;
    if (!dispatchableAgentConfigs.some((ac) => ac._id === selectedAgentConfigId)) {
      return null;
    }
    return selectedAgentConfigId;
  }, [selectedAgentConfigId, dispatchableAgentConfigs]);
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [blockerSearch, setBlockerSearch] = useState("");
  const [newTag, setNewTag] = useState("");
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<string | null>(null);
  useEffect(() => {
    // Reset stale delete error when the open issue changes (same panel, new issue).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on issueId
    setWorkspaceDeleteError(null);
  }, [issueId]);
  useEscapeClose(activeWorkspaceId ? onCloseWorkspace : onClose);

  const blockerSearchResults = useMemo(() => {
    if (!blockerSearch.trim() || !allProjectIssues) return [];
    const search = blockerSearch.toLowerCase();
    return allProjectIssues
      .filter(
        (i) =>
          i._id !== issueId &&
          !blockerIds.includes(i._id) &&
          [i.title, i.simpleId].some((s) => s.toLowerCase().includes(search))
      )
      .slice(0, 8);
  }, [blockerSearch, allProjectIssues, issueId, blockerIds]);

  if (!issue) return null;

  const startEdit = (field: string, value: string) => {
    setEditing(field);
    setEditValue(value);
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updateIssue({ id: issueId, [editing]: editValue });
    setEditing(null);
  };

  const hasActiveWorkspace = workspaces?.some(
    (ws) => !TERMINAL_STATUSES.includes(ws.status)
  );

  const handleDispatch = async () => {
    if (!effectiveAgentConfigId) return;
    await createWorkspace({
      issueId,
      projectId: issue.projectId,
      agentConfigId: effectiveAgentConfigId,
      additionalPrompt: additionalInstructions.trim() || undefined,
    });
    setShowDispatchForm(false);
    setSelectedAgentConfigId(null);
    setAdditionalInstructions("");
  };

  const handleAddComment = async () => {
    if (!commentBody.trim()) return;
    await addComment({ issueId, body: commentBody.trim(), author: "user" });
    setCommentBody("");
  };

  const handleAddBlocker = async (blockerId: Id<"issues">) => {
    const current = issue.blockedBy ?? [];
    await updateIssue({ id: issueId, blockedBy: [...current, blockerId] });
    setBlockerSearch("");
  };

  const handleRemoveBlocker = async (blockerId: Id<"issues">) => {
    const current = issue.blockedBy ?? [];
    await updateIssue({
      id: issueId,
      blockedBy: current.filter((id) => id !== blockerId),
    });
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete issue ${issue.simpleId}? This cannot be undone.`)) return;
    await removeIssue({ id: issueId });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4" onClick={onClose} data-testid="issue-detail-overlay">
      <div
        className="flex max-h-[90vh] w-[95vw] max-w-[800px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        data-testid="issue-detail-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2">
          <span className="font-mono text-sm font-semibold" data-testid="issue-detail-simple-id">
            {issue.simpleId}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {issue.archivedAt !== undefined ? (
              <Button size="sm" onClick={async () => { await unarchiveIssue({ id: issueId }); }}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={async () => { await archiveIssue({ id: issueId }); onClose(); }}>
                Archive
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onClose} aria-label="Close">
              &times;
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {editing === "title" ? (
            <Input
              className="mb-3 text-lg font-semibold"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
              autoComplete="off"
              autoFocus
            />
          ) : (
            <h2 className="mb-3 cursor-pointer text-lg font-semibold" onClick={() => startEdit("title", issue.title)}>
              {issue.title}
            </h2>
          )}

          <div className="mb-4 grid gap-3 border-b border-border pb-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={issue.status}
                onChange={(e) =>
                  moveIssue({ id: issueId, status: e.target.value, position: Date.now() })
                }
              >
                {columns?.map((col) => (
                  <option key={col._id} value={col.name}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={issue.deepResearch ?? false}
                  onChange={(e) =>
                    updateIssue({ id: issueId, deepResearch: e.target.checked })
                  }
                />
                Deep research
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={issue.grillMe ?? false}
                  onChange={(e) =>
                    updateIssue({ id: issueId, grillMe: e.target.checked })
                  }
                />
                Grill me (pre-planning interview)
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Tags</label>
              <div className="mb-2 flex flex-wrap gap-1">
                {issue.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-0.5 font-normal">
                    {tag}
                    <button
                      type="button"
                      className="rounded px-1 hover:bg-muted"
                      onClick={() =>
                        updateIssue({ id: issueId, tags: issue.tags.filter((t) => t !== tag) })
                      }
                      title="Remove tag"
                    >
                      &times;
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                placeholder="Add tag..."
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTag.trim()) {
                    const trimmed = newTag.trim();
                    if (!issue.tags.includes(trimmed)) {
                      void updateIssue({ id: issueId, tags: [...issue.tags, trimmed] });
                    }
                    setNewTag("");
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={issue.autoMerge ?? false}
                  onChange={(e) =>
                    updateIssue({ id: issueId, autoMerge: e.target.checked })
                  }
                />
                Auto-merge
              </label>
            </div>
          </div>

          {/* Blocked By Section */}
          <div className="mb-4 border-b border-border pb-4">
            <h3 className="mb-2 text-base font-semibold">Blocked By</h3>
            <div className="mb-2 flex flex-wrap gap-1">
              {blockerIssues && blockerIssues.length > 0 ? (
                blockerIssues.map((blocker) => (
                  <Badge key={blocker._id} variant="outline" className="max-w-full gap-1 py-1 pr-0.5 font-normal">
                    <span className="font-mono text-[11px]">{blocker.simpleId}</span>
                    <span className="truncate">{blocker.title}</span>
                    <button
                      type="button"
                      className="rounded px-1 hover:bg-muted"
                      onClick={() => handleRemoveBlocker(blocker._id)}
                      title="Remove blocker"
                    >
                      &times;
                    </button>
                  </Badge>
                ))
              ) : (
                <span className="font-mono text-xs text-muted-foreground">No blockers</span>
              )}
            </div>
            <div className="relative">
              <Input
                placeholder="Search issues to add as blocker..."
                value={blockerSearch}
                onChange={(e) => setBlockerSearch(e.target.value)}
                autoComplete="off"
              />
              {blockerSearchResults.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md">
                  {blockerSearchResults.map((result) => (
                    <div
                      key={result._id}
                      className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-muted"
                      onMouseDown={() => handleAddBlocker(result._id)}
                    >
                      <span className="font-mono text-xs">{result.simpleId}</span>{" "}
                      <span>{result.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {((workspaces !== undefined && workspaces.length > 0) ||
            workspaceDeleteError !== null) && (
            <div className="mb-4 border-b border-border pb-4">
              {workspaceDeleteError && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {workspaceDeleteError}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    aria-label="Dismiss error"
                    onClick={() => setWorkspaceDeleteError(null)}
                  >
                    &times;
                  </Button>
                </div>
              )}
              {workspaces && workspaces.length > 0 && (
                <>
                  <h3 className="mb-2 text-base font-semibold">Workspaces</h3>
                  {workspaces.map((ws) => {
                    const isTerminal = TERMINAL_STATUSES.includes(ws.status);
                    const canAbandon =
                      isTerminal && ws.worktrees.length > 0;
                    return (
                      <div
                        key={ws._id}
                        className="mb-2 flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
                        onClick={() => onOpenWorkspace(ws._id)}
                      >
                        <span className={cn("shrink-0", wsWorkspaceStatusClass(ws.status))}>
                          {ws.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(ws.createdAt).toLocaleString()}
                        </span>
                        {canAbandon && (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="ml-auto"
                            title="Abandon workspace and queue worktree cleanup"
                            data-testid="workspace-item-abandon"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                !window.confirm(
                                  "Abandon this workspace? Its worktrees will be removed by the worker; you can delete the record afterward.",
                                )
                              ) {
                                return;
                              }
                              setWorkspaceDeleteError(null);
                              void abandonWorkspace({ id: ws._id }).catch(
                                (err: unknown) =>
                                  setWorkspaceDeleteError(
                                    err instanceof Error
                                      ? err.message
                                      : "Failed to abandon workspace",
                                  ),
                              );
                            }}
                          >
                            Abandon
                          </Button>
                        )}
                        {isTerminal && !canAbandon && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="ml-auto size-7"
                            title="Delete workspace"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                !window.confirm(
                                  "Delete this workspace? This cannot be undone.",
                                )
                              ) {
                                return;
                              }
                              setWorkspaceDeleteError(null);
                              void removeWorkspace({ id: ws._id })
                                .catch((err: unknown) =>
                                  setWorkspaceDeleteError(
                                    err instanceof Error
                                      ? err.message
                                      : "Failed to delete workspace",
                                  ),
                                );
                            }}
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          <div className="mb-4 border-b border-border pb-4">
            {!hasActiveWorkspace && !showDispatchForm && (
              <Button onClick={() => setShowDispatchForm(true)}>Start Workspace</Button>
            )}
            {showDispatchForm && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <h4 className="font-semibold">Start Workspace</h4>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Agent Config</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={effectiveAgentConfigId ?? ""}
                    onChange={(e) =>
                      setSelectedAgentConfigId(
                        e.target.value ? (e.target.value as Id<"agentConfigs">) : null,
                      )
                    }
                  >
                    <option value="">Select agent config...</option>
                    {dispatchableAgentConfigs.map((ac) => (
                      <option key={ac._id} value={ac._id}>
                        {ac.name} ({ac.agentType})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Additional Instructions (optional)</label>
                  <Textarea
                    value={additionalInstructions}
                    onChange={(e) => setAdditionalInstructions(e.target.value)}
                    placeholder="Any additional instructions for the agent..."
                    rows={3}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleDispatch} disabled={!effectiveAgentConfigId}>
                    Start
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setShowDispatchForm(false); setSelectedAgentConfigId(null); setAdditionalInstructions(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="mb-4 border-b border-border pb-4">
            <h3 className="mb-2 text-base font-semibold">Description</h3>
            {editing === "description" ? (
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={saveEdit}
                rows={6}
                autoFocus
              />
            ) : (
              <div
                className="prose-log cursor-pointer rounded-md border border-dashed border-transparent p-2 text-sm hover:border-border"
                onClick={() => startEdit("description", issue.description)}
              >
                {issue.description ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={issueDescriptionMarkdownComponents}
                  >
                    {issue.description}
                  </ReactMarkdown>
                ) : (
                  "No description. Click to add one."
                )}
              </div>
            )}
          </div>

          <ChecklistSection issueId={issueId} checklist={issue.checklist ?? []} />

          {activeWorkspaceId && (
            <WorkspaceView
              workspaceId={activeWorkspaceId as Id<"workspaces">}
              onClose={onCloseWorkspace}
            />
          )}

          <div className="mb-4 border-b border-border pb-4">
            <h3 className="mb-2 text-base font-semibold">Comments</h3>
            {comments?.map((c) => (
              <div key={c._id} className="mb-3 rounded-md border border-border bg-secondary/30 p-3">
                <div className="mb-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.author}</span>
                  <span>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <div className="prose-log text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                </div>
              </div>
            ))}
            <div className="space-y-2" data-testid="comment-form">
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
              />
              <Button size="sm" onClick={handleAddComment}>
                Comment
              </Button>
            </div>
          </div>

          <div className="mb-4">
            <h3
              className="mb-2 cursor-pointer select-none text-base font-semibold"
              onClick={() => setShowHistory(!showHistory)}
            >
              History {showHistory ? "▾" : "▸"}
            </h3>
            {showHistory && history && (
              <div className="space-y-2 text-sm">
                {history.length === 0 ? (
                  <span className="font-mono text-xs text-muted-foreground">No history</span>
                ) : (
                  history.map((entry) => (
                    <div key={entry._id} className="flex flex-col gap-0.5 rounded-md border border-border px-2 py-1.5 font-mono text-[11px] sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-2">
                      <span className="text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                      <span
                        className={cn(
                          "font-semibold",
                          entry.actor === "user" ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {entry.actor}
                      </span>
                      <span className="text-foreground">{formatHistoryEntry(entry)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <AttachmentsSection issueId={issueId} />
        </div>
      </div>
    </div>
  );
}
