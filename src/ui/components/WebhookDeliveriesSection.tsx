import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

type Tab = "deliveries" | "dead_letters";

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusStyle(status: string): React.CSSProperties {
  switch (status) {
    case "success":
      return { background: "var(--success)", color: "white" };
    case "dead_letter":
      return { background: "var(--danger)", color: "white" };
    case "retrying":
      return { background: "var(--warning, #f59e0b)", color: "white" };
    default:
      return { background: "var(--surface-2)", color: "var(--text-muted)" };
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "success": return "Success";
    case "dead_letter": return "Dead Letter";
    case "retrying": return "Retrying";
    default: return status;
  }
}

export function WebhookDeliveriesSection({ projectId }: { projectId: Id<"projects"> }) {
  const [tab, setTab] = useState<Tab>("deliveries");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const deliveries = useQuery(api.webhooks.listDeliveriesPublic, { projectId });
  const deadLetters = useQuery(api.webhooks.listDeadLettersPublic, { projectId });

  const items = tab === "deliveries" ? deliveries : deadLetters;

  if (!items) return null;

  const deadLetterCount = deadLetters?.length ?? 0;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          className={`btn btn-sm${tab === "deliveries" ? " btn-primary" : ""}`}
          onClick={() => setTab("deliveries")}
        >
          Delivery History
        </button>
        <button
          className={`btn btn-sm${tab === "dead_letters" ? " btn-primary" : ""}`}
          onClick={() => setTab("dead_letters")}
        >
          Dead Letters{deadLetterCount > 0 ? ` (${deadLetterCount})` : ""}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="meta-value" style={{ padding: "8px 0" }}>
          {tab === "deliveries"
            ? "No delivery attempts recorded. Only failed first attempts are tracked."
            : "No dead letters."}
        </p>
      ) : (
        <div className="settings-table">
          {items.map((d) => (
            <div key={d._id} className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}
                onClick={() => setExpandedId(expandedId === d._id ? null : d._id)}
              >
                <span
                  className="badge"
                  style={{ ...statusStyle(d.status), fontSize: 11, padding: "2px 8px" }}
                >
                  {statusLabel(d.status)}
                </span>
                <span className="meta-value" style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {d.event}
                </span>
                <span className="meta-value" style={{ fontSize: 12 }}>
                  {d.url}
                </span>
                <span className="meta-value" style={{ fontSize: 11, marginLeft: "auto" }}>
                  {d.attempt}/{d.maxAttempts} attempts
                </span>
                <span className="meta-value" style={{ fontSize: 11 }}>
                  {formatTimeAgo(d.createdAt)}
                </span>
                {d.lastStatusCode && (
                  <span className="meta-value" style={{ fontSize: 11 }}>
                    HTTP {d.lastStatusCode}
                  </span>
                )}
              </div>

              {expandedId === d._id && (
                <div style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  background: "var(--surface-2, var(--bg))",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 12,
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
                    <span style={{ color: "var(--text-muted)" }}>URL:</span>
                    <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{d.url}</span>

                    <span style={{ color: "var(--text-muted)" }}>Event:</span>
                    <span>{d.event}</span>

                    <span style={{ color: "var(--text-muted)" }}>Status:</span>
                    <span>{statusLabel(d.status)}</span>

                    <span style={{ color: "var(--text-muted)" }}>Attempts:</span>
                    <span>{d.attempt} / {d.maxAttempts}</span>

                    {d.lastStatusCode !== undefined && (
                      <>
                        <span style={{ color: "var(--text-muted)" }}>HTTP Status:</span>
                        <span>{d.lastStatusCode}</span>
                      </>
                    )}

                    {d.lastError && (
                      <>
                        <span style={{ color: "var(--text-muted)" }}>Error:</span>
                        <span style={{ color: "var(--danger)" }}>{d.lastError}</span>
                      </>
                    )}

                    <span style={{ color: "var(--text-muted)" }}>Created:</span>
                    <span>{new Date(d.createdAt).toLocaleString()}</span>

                    {d.completedAt && (
                      <>
                        <span style={{ color: "var(--text-muted)" }}>Completed:</span>
                        <span>{new Date(d.completedAt).toLocaleString()}</span>
                      </>
                    )}

                    {d.nextRetryAt && (
                      <>
                        <span style={{ color: "var(--text-muted)" }}>Next Retry:</span>
                        <span>{new Date(d.nextRetryAt).toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
