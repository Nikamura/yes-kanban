import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Pricing per million tokens by model family
const MODEL_PRICING: Record<string, { input: number; cacheCreation: number; cacheRead: number; output: number }> = {
  sonnet: { input: 3, cacheCreation: 3.75, cacheRead: 0.30, output: 15 },
  opus: { input: 15, cacheCreation: 18.75, cacheRead: 1.50, output: 75 },
  haiku: { input: 0.80, cacheCreation: 1.00, cacheRead: 0.08, output: 4 },
};
const DEFAULT_PRICING = MODEL_PRICING["sonnet"]!;

function getPricing(model?: string) {
  if (!model) return DEFAULT_PRICING;
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return MODEL_PRICING["opus"]!;
  if (lower.includes("haiku")) return MODEL_PRICING["haiku"]!;
  return DEFAULT_PRICING;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  pricing = DEFAULT_PRICING,
): number {
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (cacheCreationTokens / 1_000_000) * pricing.cacheCreation +
    (cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (outputTokens / 1_000_000) * pricing.output
  );
}

function formatCost(cost: number): string {
  return "$" + cost.toFixed(2);
}

function formatDuration(startedAt: number, finishedAt?: number): string {
  if (!finishedAt) return "running...";
  const seconds = Math.round((finishedAt - startedAt) / 1000);
  if (seconds < 60) return String(seconds) + "s";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return String(mins) + "m " + String(secs) + "s";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TokenDashboard({ projectId }: { projectId: Id<"projects"> }) {
  const data = useQuery(api.stats.tokenUsage, { projectId });

  if (!data) return <div className="loading">Loading...</div>;

  // Sum per-agent costs to respect model-specific pricing
  let totalCost = 0;
  let uncachedCost = 0;
  for (const agent of data.byAgent) {
    const pricing = getPricing(agent.model);
    totalCost += calculateCost(
      agent.inputTokens, agent.outputTokens,
      agent.cacheCreationTokens, agent.cacheReadTokens, pricing,
    );
    uncachedCost += calculateCost(
      agent.inputTokens + agent.cacheReadTokens, agent.outputTokens,
      agent.cacheCreationTokens, 0, pricing,
    );
  }
  const cacheSavings = uncachedCost - totalCost;

  const maxAgentTokens = Math.max(...data.byAgent.map((a) => a.totalTokens), 1);

  return (
    <div className="dashboard">
      <h2 className="dashboard-title">Token Usage Dashboard</h2>

      {/* Summary stat cards */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-label">Total Tokens</div>
          <div className="stat-value">{formatTokens(data.totalTokens)}</div>
          <div className="stat-detail">
            {formatTokens(data.totalInputTokens)} in / {formatTokens(data.totalOutputTokens)} out
          </div>
          {(data.totalCacheCreationTokens > 0 || data.totalCacheReadTokens > 0) && (
            <div className="stat-detail">
              {formatTokens(data.totalCacheCreationTokens)} cache write / {formatTokens(data.totalCacheReadTokens)} cache read
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-label">Estimated Cost</div>
          <div className="stat-value">{formatCost(totalCost)}</div>
          {/* Cost uses per-agent model pricing when available, falls back to Sonnet */}
          <div className="stat-detail">
            across {data.totalRuns} runs
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Runs</div>
          <div className="stat-value">{data.totalRuns}</div>
          <div className="stat-detail">
            {data.succeededRuns} succeeded
          </div>
        </div>
        {cacheSavings > 0 && (
          <div className="stat-card stat-card-success">
            <div className="stat-label">Cache Savings</div>
            <div className="stat-value">{formatCost(cacheSavings)}</div>
            <div className="stat-detail">
              {formatTokens(data.totalCacheReadTokens)} tokens served from cache
            </div>
          </div>
        )}
        <div className="stat-card stat-card-success">
          <div className="stat-label">Succeeded</div>
          <div className="stat-value">{data.succeededRuns}</div>
        </div>
        <div className="stat-card stat-card-failed">
          <div className="stat-label">Failed</div>
          <div className="stat-value">{data.failedRuns}</div>
        </div>
        <div className="stat-card stat-card-timeout">
          <div className="stat-label">Timed Out</div>
          <div className="stat-value">{data.timedOutRuns}</div>
        </div>
      </div>

      {/* Usage by agent */}
      {data.byAgent.length > 0 && (
        <div className="dashboard-section">
          <h3>Usage by Agent</h3>
          <div className="agent-bars">
            {data.byAgent
              .sort((a, b) => b.totalTokens - a.totalTokens)
              .map((agent) => {
                const pricing = getPricing(agent.model);
                const agentCost = calculateCost(
                  agent.inputTokens,
                  agent.outputTokens,
                  agent.cacheCreationTokens,
                  agent.cacheReadTokens,
                  pricing,
                );
                return (
                  <div key={agent.agentConfigName} className="agent-bar-row">
                    <div className="agent-bar-label">
                      <span className="agent-bar-name">{agent.agentConfigName}</span>
                      <span className="agent-bar-meta">
                        {formatTokens(agent.totalTokens)} tokens / {agent.runCount} runs
                        {agent.cacheReadTokens > 0 && ` / ${formatTokens(agent.cacheReadTokens)} cached`}
                      </span>
                    </div>
                    <div className="agent-bar-track">
                      <div
                        className="agent-bar-fill agent-bar-input"
                        style={{
                          width: `${(agent.inputTokens / maxAgentTokens) * 100}%`,
                        }}
                      />
                      <div
                        className="agent-bar-fill agent-bar-output"
                        style={{
                          width: `${(agent.outputTokens / maxAgentTokens) * 100}%`,
                          left: `${(agent.inputTokens / maxAgentTokens) * 100}%`,
                        }}
                      />
                      {agent.cacheReadTokens > 0 && (
                        <div
                          className="agent-bar-fill agent-bar-cache"
                          style={{
                            width: `${(agent.cacheReadTokens / maxAgentTokens) * 100}%`,
                            left: `${((agent.inputTokens + agent.outputTokens) / maxAgentTokens) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                    <div className="agent-bar-cost">
                      {formatCost(agentCost)}
                    </div>
                  </div>
                );
              })}
            <div className="agent-bar-legend">
              <span className="legend-item">
                <span className="legend-swatch legend-input" /> Input
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-output" /> Output
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-cache" /> Cache Read
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Recent runs table */}
      {data.recentRuns.length > 0 && (
        <div className="dashboard-section">
          <h3>Recent Runs</h3>
          <div className="dashboard-table-wrap">
            <table className="list-table dashboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>Agent</th>
                  <th>Type</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cache</th>
                  <th>Total</th>
                  <th>Duration</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run._id}>
                    <td className="mono-cell">{run.attemptNumber}</td>
                    <td>
                      <span className={`status-badge ws-status-${run.status}`}>
                        {run.status}
                      </span>
                    </td>
                    <td>{run.agentConfigName}</td>
                    <td>{run.type}</td>
                    <td className="mono-cell">{formatTokens(run.inputTokens)}</td>
                    <td className="mono-cell">{formatTokens(run.outputTokens)}</td>
                    <td className="mono-cell">
                      {run.cacheReadTokens > 0 ? formatTokens(run.cacheReadTokens) : "-"}
                    </td>
                    <td className="mono-cell">{formatTokens(run.totalTokens)}</td>
                    <td className="mono-cell">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </td>
                    <td className="date-cell">{formatTime(run.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.totalRuns === 0 && (
        <div className="dashboard-empty">
          No run data yet. Token usage will appear here once agents start running.
        </div>
      )}
    </div>
  );
}
