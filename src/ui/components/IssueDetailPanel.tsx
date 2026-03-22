import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useMemo } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { WorkspaceView } from "./WorkspaceView";
import { AttachmentsSection } from "./AttachmentsSection";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { ChecklistSection } from "./ChecklistSection";
import { formatHistoryEntry } from "../formatHistoryEntry";
import { TERMINAL_STATUSES, CARD_COLORS } from "../utils/constants";
import { timestampToDateStr, dateToTimestamp } from "../utils/dueDate";
import { describeCron } from "../../../convex/lib/cronParser";

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

  const agentConfigs = useQuery(api.agentConfigs.list, issue ? { projectId: issue.projectId } : "skip");
  const createWorkspace = useMutation(api.workspaces.create);
  const recurrenceRule = useQuery(api.recurrenceRules.getByIssueId, { issueId });

  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [selectedAgentConfigId, setSelectedAgentConfigId] = useState<Id<"agentConfigs"> | null>(null);
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [blockerSearch, setBlockerSearch] = useState("");
  const [newTag, setNewTag] = useState("");
  useEscapeClose(activeWorkspaceId ? onCloseWorkspace : onClose);

  const blockerSearchResults = useMemo(() => {
    if (!blockerSearch.trim() || !allProjectIssues) return [];
    const search = blockerSearch.toLowerCase();
    return allProjectIssues
      .filter(
        (i) =>
          i._id !== issueId &&
          !blockerIds.includes(i._id) &&
          (i.title.toLowerCase().includes(search) ||
            i.simpleId.toLowerCase().includes(search))
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
    if (!selectedAgentConfigId) return;
    await createWorkspace({
      issueId,
      projectId: issue.projectId,
      agentConfigId: selectedAgentConfigId,
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
    <div className="panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="issue-id">{issue.simpleId}</span>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            Delete
          </button>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="panel-body">
          {editing === "title" ? (
            <input
              className="edit-title"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
              autoComplete="off"
              autoFocus
            />
          ) : (
            <h2 className="issue-title" onClick={() => startEdit("title", issue.title)}>
              {issue.title}
            </h2>
          )}

          <div className="issue-meta">
            <div className="meta-item">
              <label>Status</label>
              <select
                className="meta-select"
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
            <div className="meta-item">
              <label>Priority</label>
              <select
                className="meta-select"
                value={issue.priority ?? ""}
                onChange={(e) =>
                  updateIssue({ id: issueId, priority: e.target.value || undefined })
                }
              >
                <option value="">None</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="meta-item">
              <label>Color</label>
              <div className="color-picker-swatches">
                {CARD_COLORS.map((c) => (
                  <button
                    key={c.value}
                    className={`color-swatch${issue.color === c.value ? " active" : ""}`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                    onClick={() => updateIssue({ id: issueId, color: c.value })}
                  />
                ))}
                {issue.color && (
                  <button
                    className="color-swatch color-swatch-clear"
                    title="Clear color"
                    onClick={() => updateIssue({ id: issueId, color: "" })}
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
            <div className="meta-item">
              <label>Due Date</label>
              <input
                type="date"
                className="meta-select"
                value={issue.dueDate ? timestampToDateStr(issue.dueDate) : ""}
                onChange={(e) => {
                  const ts = dateToTimestamp(e.target.value);
                  // Pass 0 as sentinel for "clear due date" — handled in mutation
                  void updateIssue({ id: issueId, dueDate: ts ?? 0 });
                }}
              />
            </div>
            <div className="meta-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={issue.deepResearch ?? false}
                  onChange={(e) =>
                    updateIssue({ id: issueId, deepResearch: e.target.checked })
                  }
                />
                Deep research
              </label>
            </div>
            <div className="meta-item meta-item-tags">
              <label>Tags</label>
              <div className="tag-chips">
                {issue.tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button
                      className="tag-chip-remove"
                      onClick={() =>
                        updateIssue({ id: issueId, tags: issue.tags.filter((t) => t !== tag) })
                      }
                      title="Remove tag"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <input
                className="tag-input"
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
            <div className="meta-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={issue.autoMerge ?? false}
                  onChange={(e) =>
                    updateIssue({ id: issueId, autoMerge: e.target.checked })
                  }
                />
                Auto-merge
              </label>
            </div>
            {recurrenceRule && (
              <div className="meta-item">
                <label>Recurrence</label>
                <span className="meta-value">
                  ↻{" "}
                  {recurrenceRule.triggerMode === "fixed" && recurrenceRule.cronExpression
                    ? describeCron(recurrenceRule.cronExpression)
                    : "On completion"}
                  {recurrenceRule.status === "paused" && " (paused)"}
                </span>
              </div>
            )}
          </div>

          {/* Blocked By Section */}
          <div className="blocked-by-section">
            <h3>Blocked By</h3>
            <div className="blocker-chips">
              {blockerIssues && blockerIssues.length > 0 ? (
                blockerIssues.map((blocker) => (
                  <span key={blocker._id} className="blocker-chip">
                    <span className="blocker-chip-id">{blocker.simpleId}</span>
                    <span className="blocker-chip-title">{blocker.title}</span>
                    <button
                      className="blocker-chip-remove"
                      onClick={() => handleRemoveBlocker(blocker._id)}
                      title="Remove blocker"
                    >
                      &times;
                    </button>
                  </span>
                ))
              ) : (
                <span className="meta-value">No blockers</span>
              )}
            </div>
            <div className="blocker-search-container">
              <input
                className="blocker-search-input"
                placeholder="Search issues to add as blocker..."
                value={blockerSearch}
                onChange={(e) => setBlockerSearch(e.target.value)}
                autoComplete="off"
              />
              {blockerSearchResults.length > 0 && (
                <div className="blocker-search-dropdown">
                  {blockerSearchResults.map((result) => (
                    <div
                      key={result._id}
                      className="blocker-search-item"
                      onMouseDown={() => handleAddBlocker(result._id)}
                    >
                      <span className="issue-id">{result.simpleId}</span>
                      <span>{result.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {workspaces && workspaces.length > 0 && (
            <div className="workspaces-section">
              <h3>Workspaces</h3>
              {workspaces.map((ws) => (
                <div
                  key={ws._id}
                  className="workspace-item"
                  style={{ cursor: "pointer" }}
                  onClick={() => onOpenWorkspace(ws._id)}
                >
                  <span className={`ws-status ws-status-${ws.status}`}>
                    {ws.status}
                  </span>
                  <span className="ws-date">
                    {new Date(ws.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="dispatch-section">
            {!hasActiveWorkspace && !showDispatchForm && (
              <button
                className="btn btn-primary"
                onClick={() => setShowDispatchForm(true)}
              >
                Start Workspace
              </button>
            )}
            {showDispatchForm && (
              <div className="dispatch-form">
                <h4>Start Workspace</h4>
                <div className="form-group">
                  <label className="form-label">Agent Config</label>
                  <select
                    value={selectedAgentConfigId ?? ""}
                    onChange={(e) => setSelectedAgentConfigId(e.target.value as Id<"agentConfigs">)}
                  >
                    <option value="">Select agent config...</option>
                    {agentConfigs?.map((ac) => (
                      <option key={ac._id} value={ac._id}>
                        {ac.name} ({ac.agentType})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Additional Instructions (optional)</label>
                  <textarea
                    value={additionalInstructions}
                    onChange={(e) => setAdditionalInstructions(e.target.value)}
                    placeholder="Any additional instructions for the agent..."
                    rows={3}
                  />
                </div>
                <div className="form-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleDispatch}
                    disabled={!selectedAgentConfigId}
                  >
                    Start
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => { setShowDispatchForm(false); setSelectedAgentConfigId(null); setAdditionalInstructions(""); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="issue-description">
            <h3>Description</h3>
            {editing === "description" ? (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={saveEdit}
                rows={6}
                autoFocus
              />
            ) : (
              <div
                className="description-content"
                onClick={() => startEdit("description", issue.description)}
              >
                {issue.description || "No description. Click to add one."}
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

          <div className="comments-section">
            <h3>Comments</h3>
            {comments?.map((c) => (
              <div key={c._id} className="comment">
                <div className="comment-header">
                  <span className="comment-author">{c.author}</span>
                  <span className="comment-date">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="comment-body markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                </div>
              </div>
            ))}
            <div className="comment-form">
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
              />
              <button className="btn btn-primary btn-sm" onClick={handleAddComment}>
                Comment
              </button>
            </div>
          </div>

          <div className="history-section">
            <h3
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => setShowHistory(!showHistory)}
            >
              History {showHistory ? "▾" : "▸"}
            </h3>
            {showHistory && history && (
              <div className="history-entries">
                {history.length === 0 ? (
                  <span className="meta-value">No history</span>
                ) : (
                  history.map((entry) => (
                    <div key={entry._id} className="history-entry">
                      <span className="history-date">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                      <span className={`history-actor history-actor-${entry.actor}`}>
                        {entry.actor}
                      </span>
                      <span className="history-description">
                        {formatHistoryEntry(entry)}
                      </span>
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
