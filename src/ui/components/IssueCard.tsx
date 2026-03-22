import type { Doc } from "../../../convex/_generated/dataModel";
import { PRIORITY_COLORS } from "../utils/constants";
import { getDueDateInfo } from "../utils/dueDate";

export function IssueCard({
  issue,
  workspaceStatus,
  behindMainBy,
  isDragging = false,
  selectionMode = false,
  selected = false,
  focused = false,
  onClick,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onLongPressStart,
  onLongPressEnd,
  onStatusClick,
}: {
  issue: Doc<"issues">;
  workspaceStatus?: string;
  behindMainBy?: number;
  isDragging?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  focused?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragEnd?: () => void;
  onLongPressStart?: () => void;
  onLongPressEnd?: () => void;
  onStatusClick?: (e: React.MouseEvent) => void;
}) {
  const priorityColor = issue.priority ? PRIORITY_COLORS[issue.priority] : "var(--border)";
  const stripeColor = issue.color ?? priorityColor;

  return (
    <div
      className={`issue-card ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${focused ? "focused" : ""}`}
      draggable={!selectionMode}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTouchStart={onLongPressStart}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
    >
      {selectionMode && (
        <div
          className={`issue-card-checkbox ${selected ? "checked" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(e);
          }}
        />
      )}
      <div
        className="issue-card-priority-strip"
        style={{ backgroundColor: stripeColor }}
      />
      <div className="issue-card-content">
        <div className="issue-card-header">
          <span className="issue-id">{issue.simpleId}</span>
          {workspaceStatus && (
            <span
              className={`ws-status ws-status-${workspaceStatus} issue-card-ws-status${onStatusClick ? " clickable" : ""}`}
              onClick={onStatusClick ? (e) => { e.stopPropagation(); onStatusClick(e); } : undefined}
            >
              {workspaceStatus}
            </span>
          )}
          {behindMainBy !== undefined && behindMainBy > 0 && (
            <span className="ws-behind-main" title={`${behindMainBy} commit(s) behind main`}>
              ↓{behindMainBy}
            </span>
          )}
          {issue.priority && (
            <span
              className="issue-priority"
              style={{ color: PRIORITY_COLORS[issue.priority] }}
            >
              {issue.priority}
            </span>
          )}
        </div>
        <div className="issue-card-title">{issue.title}</div>
        {issue.dueDate && (
          <DueDateBadge dueDate={issue.dueDate} />
        )}
        {issue.checklist && issue.checklist.length > 0 && (
          <ChecklistProgress checklist={issue.checklist} />
        )}
        {issue.tags.length > 0 && (
          <div className="issue-tags">
            {issue.tags.map((tag) => (
              <span key={tag} className="issue-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistProgress({ checklist }: { checklist: { completed: boolean }[] }) {
  const done = checklist.filter((i) => i.completed).length;
  const total = checklist.length;
  return (
    <div className="checklist-card-progress">
      <div className="checklist-card-progress-bar-container">
        <div
          className={`checklist-card-progress-bar ${done === total ? "complete" : ""}`}
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <span className="checklist-card-progress-text">{done}/{total}</span>
    </div>
  );
}

function DueDateBadge({ dueDate }: { dueDate: number }) {
  const info = getDueDateInfo(dueDate);
  return (
    <span className={`due-date-badge ${info.className}`} title={new Date(dueDate).toLocaleDateString()}>
      {info.label}
    </span>
  );
}
