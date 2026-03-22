import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatHistoryEntry } from "../formatHistoryEntry";

const ACTION_ICONS: Record<string, string> = {
  created: "+",
  moved: "→",
  updated: "~",
};

const EVENT_TYPES = ["created", "moved", "updated"] as const;

export function ActivityFeed({ projectId, onOpenIssue }: { projectId: Id<"projects">; onOpenIssue?: (simpleId: string) => void }) {
  const entries = useQuery(api.activityFeed.recent, { projectId, limit: 50 });
  const [filterAction, setFilterAction] = useState<string>("");

  if (!entries) return <div className="loading">Loading activity...</div>;

  const filtered = filterAction
    ? entries.filter((e) => e.action === filterAction)
    : entries;

  return (
    <div className="activity-feed">
      <div className="activity-feed-filters">
        <button
          className={`btn btn-sm ${filterAction === "" ? "btn-primary" : ""}`}
          onClick={() => setFilterAction("")}
        >
          All
        </button>
        {EVENT_TYPES.map((type) => (
          <button
            key={type}
            className={`btn btn-sm ${filterAction === type ? "btn-primary" : ""}`}
            onClick={() => setFilterAction(type)}
          >
            {type}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No activity yet</div>
      ) : (
        <div className="activity-timeline">
          {filtered.map((entry) => (
            <div key={entry._id} className="activity-entry">
              <span className="activity-icon">
                {ACTION_ICONS[entry.action] ?? "·"}
              </span>
              <div className="activity-content">
                <span
                  className="activity-issue-link"
                  onClick={() => onOpenIssue?.(entry.issueSimpleId)}
                >
                  {entry.issueSimpleId}
                </span>
                <span className="activity-description">
                  {formatHistoryEntry(entry)}
                </span>
                <span className="activity-meta">
                  <span className={`history-actor history-actor-${entry.actor}`}>
                    {entry.actor}
                  </span>
                  <span className="activity-time">
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                </span>
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
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
