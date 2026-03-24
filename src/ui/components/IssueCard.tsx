import type { Doc } from "../../../convex/_generated/dataModel";
import { cn } from "@/ui/lib/utils";

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
  return (
    <div
      data-testid="issue-card"
      className={cn(
        "issue-card",
        selected && "selected",
        isDragging && "dragging",
        focused && "focused"
      )}
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
        </div>
        <div className="issue-card-title">{issue.title}</div>
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
