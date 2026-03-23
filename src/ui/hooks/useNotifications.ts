import { useEffect, useRef } from "react";

interface NotificationPrefs {
  enabled: boolean;
  sound: boolean;
  events: {
    question: boolean;
    planSubmitted: boolean;
    completed: boolean;
    merged: boolean;
    failed: boolean;
  };
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  sound: false,
  events: {
    question: true,
    planSubmitted: true,
    completed: true,
    merged: true,
    failed: true,
  },
};

const PREFS_KEY = "yk-notification-prefs";

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_PREFS, ...parsed, events: { ...DEFAULT_PREFS.events, ...parsed.events } };
    }
  } catch { /* ignore */ }
  return DEFAULT_PREFS;
}

export function setNotificationPrefs(prefs: NotificationPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

const NOTIFY_STATUSES = new Set([
  "awaiting_feedback",
  "waiting_for_answer",
  "completed",
  "merged",
  "failed",
]);

function statusToEvent(status: string): keyof NotificationPrefs["events"] | null {
  switch (status) {
    case "awaiting_feedback": return "planSubmitted";
    case "waiting_for_answer": return "question";
    case "completed": return "completed";
    case "merged": return "merged";
    case "failed": return "failed";
    default: return null;
  }
}

function statusToTitle(status: string): string {
  switch (status) {
    case "awaiting_feedback": return "Plan ready for review";
    case "waiting_for_answer": return "Agent has a question";
    case "completed": return "Task completed";
    case "merged": return "Changes merged";
    case "failed": return "Task failed";
    default: return status;
  }
}

function buildStatusMap(statuses: WorkspaceStatuses): Map<string, string> {
  const map = new Map<string, string>();
  for (const [issueId, ws] of Object.entries(statuses)) {
    map.set(issueId, ws.status);
  }
  return map;
}

function getSlugFromHash(): string {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/");
  return parts[0] ?? "";
}

type WorkspaceStatuses = Record<string, { status: string; workspaceId: string }>;

export function useNotifications(
  workspaceStatuses: WorkspaceStatuses | undefined,
  issues: Array<{ _id: string; simpleId: string; title: string }> | undefined,
) {
  const prevStatuses = useRef<Map<string, string>>(new Map());
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!workspaceStatuses || !issues) return;

    // Skip notifications on first load — just record initial state
    if (!isInitialized.current) {
      prevStatuses.current = buildStatusMap(workspaceStatuses);
      isInitialized.current = true;
      return;
    }

    const prefs = getNotificationPrefs();

    if (prefs.enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const issueMap = new Map(issues.map((i) => [i._id, i]));

      for (const [issueId, ws] of Object.entries(workspaceStatuses)) {
        const prevStatus = prevStatuses.current.get(issueId);
        if (prevStatus === ws.status) continue;
        if (!NOTIFY_STATUSES.has(ws.status)) continue;

        const event = statusToEvent(ws.status);
        if (!event || !prefs.events[event]) continue;

        const issue = issueMap.get(issueId);
        const title = statusToTitle(ws.status);
        const body = issue ? `${issue.simpleId}: ${issue.title}` : "Issue update";

        const notification = new Notification(title, { body, tag: `yk-${issueId}-${ws.status}` });
        notification.onclick = () => {
          window.focus();
          if (issue) {
            const slug = getSlugFromHash();
            window.location.hash = `#/${slug}/board/${issue.simpleId}/ws/${ws.workspaceId}`;
          }
        };
      }
    }

    prevStatuses.current = buildStatusMap(workspaceStatuses);
  }, [workspaceStatuses, issues]);
}
