import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatHistoryEntry } from "../formatHistoryEntry";
import { Button } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/utils";

const ACTION_ICONS: Record<string, string> = {
  created: "+",
  moved: "→",
  updated: "~",
};

const EVENT_TYPES = ["created", "moved", "updated"] as const;

export function ActivityFeed({ projectId, onOpenIssue }: { projectId: Id<"projects">; onOpenIssue?: (simpleId: string) => void }) {
  const entries = useQuery(api.activityFeed.recent, { projectId, limit: 50 });
  const [filterAction, setFilterAction] = useState<string>("");

  if (!entries) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading activity...
      </div>
    );
  }

  const filtered = filterAction
    ? entries.filter((e) => e.action === filterAction)
    : entries;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <div className="mb-3 flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant={filterAction === "" ? "default" : "outline"}
          onClick={() => setFilterAction("")}
        >
          All
        </Button>
        {EVENT_TYPES.map((type) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={filterAction === type ? "default" : "outline"}
            onClick={() => setFilterAction(type)}
          >
            {type}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">No activity yet</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {filtered.map((entry) => (
            <div key={entry._id} className="flex gap-3 border-b border-border pb-3 last:border-0">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-sm">
                {ACTION_ICONS[entry.action] ?? "·"}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <button
                  type="button"
                  className="mr-1 font-mono text-xs font-semibold text-primary hover:underline"
                  onClick={() => onOpenIssue?.(entry.issueSimpleId)}
                >
                  {entry.issueSimpleId}
                </button>
                <span className="text-foreground">{formatHistoryEntry(entry)}</span>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className={cn("font-medium", entry.actor === "user" ? "text-primary" : "")}>
                    {entry.actor}
                  </span>
                  <span>{formatRelativeTime(entry.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
