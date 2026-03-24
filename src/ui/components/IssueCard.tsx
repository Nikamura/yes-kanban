import type { Doc } from "../../../convex/_generated/dataModel";
import { cn } from "@/ui/lib/utils";
import { wsStatusCardBadgeClass, wsStatusStyle } from "@/ui/lib/wsStatusColors";

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
  const statusStyle = workspaceStatus ? wsStatusStyle(workspaceStatus) : undefined;

  return (
    <div
      data-testid="issue-card"
      data-issue-card
      data-dragging={isDragging ? "true" : undefined}
      className={cn(
        "relative flex min-h-11 cursor-pointer gap-2.5 rounded-lg border border-border bg-secondary p-3 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,background,box-shadow,transform] duration-200",
        "hover:-translate-y-px hover:border-primary hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.04)]",
        "active:translate-y-0 active:shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]",
        selected &&
          "border-primary bg-primary/[0.08] shadow-[0_0_12px_rgba(37,99,235,0.15)]",
        isDragging && "border-dashed border-primary opacity-30 shadow-none",
        focused &&
          "border-primary shadow-[0_0_0_1px_var(--primary),0_0_12px_rgba(37,99,235,0.15)]",
        !selectionMode && "cursor-grab active:cursor-grabbing",
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
        <button
          type="button"
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 border-border bg-transparent transition-colors",
            selected && "border-primary bg-primary",
          )}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(e);
          }}
        >
          {selected && (
            <span
              className="mb-0.5 ml-px block h-2.5 w-1.5 rotate-45 border-r-2 border-b-2 border-white"
              aria-hidden
            />
          )}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">{issue.simpleId}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {workspaceStatus && (
              <span
                className={cn(
                  wsStatusCardBadgeClass,
                  onStatusClick && "cursor-pointer hover:brightness-125",
                )}
                style={statusStyle}
                onClick={onStatusClick ? (e) => { e.stopPropagation(); onStatusClick(e); } : undefined}
              >
                {workspaceStatus}
              </span>
            )}
            {behindMainBy !== undefined && behindMainBy > 0 && (
              <span
                className="rounded px-1 py-px font-mono text-[9px] font-semibold text-orange-500 bg-orange-500/10"
                title={`${behindMainBy} commit(s) behind main`}
              >
                ↓{behindMainBy}
              </span>
            )}
          </div>
        </div>
        <div className="text-[13px] leading-snug font-medium">{issue.title}</div>
        {issue.checklist && issue.checklist.length > 0 && (
          <ChecklistProgress checklist={issue.checklist} />
        )}
        {issue.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {issue.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-[10px] bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
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
  const complete = done === total;
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <div className="h-1 flex-1 overflow-hidden rounded-sm bg-secondary">
        <div
          className={cn("h-full rounded-sm bg-primary transition-[width]", complete && "bg-emerald-600")}
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
        {done}/{total}
      </span>
    </div>
  );
}
