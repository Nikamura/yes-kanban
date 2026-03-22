import { useState } from "react";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { TokenDashboard } from "./TokenDashboard";
import type { Id } from "../../../convex/_generated/dataModel";

type Tab = "analytics" | "tokens";

export function DashboardView({ projectId }: { projectId: Id<"projects"> }) {
  const [activeTab, setActiveTab] = useState<Tab>("analytics");

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-tabs">
        <button
          className={`dashboard-tab ${activeTab === "analytics" ? "active" : ""}`}
          onClick={() => setActiveTab("analytics")}
        >
          Analytics
        </button>
        <button
          className={`dashboard-tab ${activeTab === "tokens" ? "active" : ""}`}
          onClick={() => setActiveTab("tokens")}
        >
          Token Usage
        </button>
      </div>
      {activeTab === "analytics" ? (
        <AnalyticsDashboard projectId={projectId} />
      ) : (
        <TokenDashboard projectId={projectId} />
      )}
    </div>
  );
}
