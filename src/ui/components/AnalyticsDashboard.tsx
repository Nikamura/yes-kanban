import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, CartesianGrid,
} from "recharts";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import type { Id } from "../../../convex/_generated/dataModel";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: 0 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const CHART_THEME = {
  bg: "transparent",
  grid: "#2a3654",
  text: "#94a3b8",
  tooltip: { bg: "#1a2340", border: "#2a3654", text: "#e2e8f0" },
};

function formatWeekLabel(label: unknown): string {
  const week = String(label);
  const [y, m, d] = week.split("-").map(Number);
  const date = new Date(y!, m! - 1, d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AnalyticsDashboard({ projectId }: { projectId: Id<"projects"> }) {
  const [presetDays, setPresetDays] = useState(90);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPriority, setSelectedPriority] = useState("");
  const [throughputMode, setThroughputMode] = useState<"weekly" | "monthly">("weekly");

  const [now] = useState(() => Date.now());

  const timeRange = useMemo(() => {
    if (customStart || customEnd) {
      return {
        startTime: customStart ? new Date(customStart).getTime() : undefined,
        endTime: customEnd ? new Date(customEnd + "T23:59:59").getTime() : undefined,
      };
    }
    if (presetDays === 0) return { startTime: 0 };
    return { startTime: now - presetDays * DAY_MS };
  }, [presetDays, customStart, customEnd, now]);

  const {
    isLoading, truncated, columns, availableTags, availablePriorities,
    cycleTimeData, throughputData, cumulativeFlowData,
    avgTimePerColumn, createdVsCompleted, summary,
  } = useAnalyticsData({
    projectId,
    ...timeRange,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    priority: selectedPriority || undefined,
  });

  if (isLoading) return <div className="loading">Loading analytics...</div>;

  const hasData = summary.totalCreated > 0 || summary.totalCompleted > 0;

  return (
    <div className="analytics">
      {/* Filter bar */}
      <div className="analytics-filters">
        <div className="analytics-filter-group">
          <label>Range:</label>
          <div className="analytics-presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className={`analytics-preset-btn ${presetDays === p.days && !customStart && !customEnd ? "active" : ""}`}
                onClick={() => { setPresetDays(p.days); setCustomStart(""); setCustomEnd(""); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            className="analytics-date-input"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            placeholder="Start"
          />
          <span className="analytics-date-sep">-</span>
          <input
            type="date"
            className="analytics-date-input"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            placeholder="End"
          />
        </div>
        {availableTags.length > 0 && (
          <div className="analytics-filter-group">
            <label>Tags:</label>
            <select
              className="analytics-select"
              multiple
              value={selectedTags}
              onChange={(e) => setSelectedTags(Array.from(e.target.selectedOptions, (o) => o.value))}
            >
              {availableTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        {availablePriorities.length > 0 && (
          <div className="analytics-filter-group">
            <label>Priority:</label>
            <select
              className="analytics-select"
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
            >
              <option value="">All</option>
              {availablePriorities.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
      </div>

      {truncated && (
        <div className="analytics-warning">
          Results limited to 10,000 history records. Try narrowing the date range for complete data.
        </div>
      )}

      {!hasData ? (
        <div className="dashboard-empty">
          No issue data in the selected time range. Create and move issues through columns to see analytics.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="dashboard-stats">
            <div className="stat-card">
              <div className="stat-label">Avg Cycle Time</div>
              <div className="stat-value">
                {summary.avgCycleTime > 0 ? `${summary.avgCycleTime}d` : "-"}
              </div>
              <div className="stat-detail">In Progress to Done</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Throughput / Week</div>
              <div className="stat-value">{summary.throughputPerWeek}</div>
              <div className="stat-detail">cards completed</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Created</div>
              <div className="stat-value">{summary.totalCreated}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Completed</div>
              <div className="stat-value">{summary.totalCompleted}</div>
            </div>
          </div>

          {/* Cycle Time Trend */}
          {cycleTimeData.trend.length > 0 && (
            <div className="dashboard-section">
              <h3>Cycle Time Trend (days)</h3>
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={cycleTimeData.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis dataKey="week" tick={{ fill: CHART_THEME.text, fontSize: 12 }} tickFormatter={formatWeekLabel} />
                    <YAxis tick={{ fill: CHART_THEME.text, fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, color: CHART_THEME.tooltip.text, borderRadius: 6 }}
                      labelFormatter={formatWeekLabel}
                    />
                    <Bar dataKey="avgDays" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Avg Days" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Throughput */}
          {(throughputData.weekly.length > 0 || throughputData.monthly.length > 0) && (
            <div className="dashboard-section">
              <h3>
                Throughput
                <span className="analytics-toggle">
                  <button
                    className={throughputMode === "weekly" ? "active" : ""}
                    onClick={() => setThroughputMode("weekly")}
                  >Weekly</button>
                  <button
                    className={throughputMode === "monthly" ? "active" : ""}
                    onClick={() => setThroughputMode("monthly")}
                  >Monthly</button>
                </span>
              </h3>
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={
                    throughputMode === "weekly"
                      ? throughputData.weekly.map((d) => ({ period: d.week, count: d.count }))
                      : throughputData.monthly.map((d) => ({ period: d.month, count: d.count }))
                  }>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis
                      dataKey="period"
                      tick={{ fill: CHART_THEME.text, fontSize: 12 }}
                      tickFormatter={throughputMode === "weekly" ? formatWeekLabel : undefined}
                    />
                    <YAxis tick={{ fill: CHART_THEME.text, fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, color: CHART_THEME.tooltip.text, borderRadius: 6 }}
                      labelFormatter={throughputMode === "weekly" ? formatWeekLabel : undefined}
                    />
                    <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Cumulative Flow Diagram */}
          {cumulativeFlowData.length > 0 && columns.length > 0 && (
            <div className="dashboard-section">
              <h3>Cumulative Flow</h3>
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={cumulativeFlowData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis dataKey="date" tick={{ fill: CHART_THEME.text, fontSize: 12 }} tickFormatter={formatWeekLabel} />
                    <YAxis tick={{ fill: CHART_THEME.text, fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, color: CHART_THEME.tooltip.text, borderRadius: 6 }}
                    />
                    {[...columns].reverse().map((col) => (
                      <Area
                        key={col.name}
                        type="monotone"
                        dataKey={col.name}
                        stackId="1"
                        fill={col.color}
                        stroke={col.color}
                        fillOpacity={0.7}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Average Time per Column */}
          {avgTimePerColumn.some((c) => c.avgDays > 0) && (
            <div className="dashboard-section">
              <h3>Average Time per Column (days)</h3>
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height={Math.max(200, avgTimePerColumn.length * 40)}>
                  <BarChart data={avgTimePerColumn} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis type="number" tick={{ fill: CHART_THEME.text, fontSize: 12 }} />
                    <YAxis type="category" dataKey="column" tick={{ fill: CHART_THEME.text, fontSize: 12 }} width={100} />
                    <Tooltip
                      contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, color: CHART_THEME.tooltip.text, borderRadius: 6 }}
                    />
                    <Bar dataKey="avgDays" name="Avg Days" radius={[0, 4, 4, 0]} fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Created vs Completed */}
          {createdVsCompleted.length > 0 && (
            <div className="dashboard-section">
              <h3>Created vs Completed</h3>
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={createdVsCompleted}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis dataKey="week" tick={{ fill: CHART_THEME.text, fontSize: 12 }} tickFormatter={formatWeekLabel} />
                    <YAxis tick={{ fill: CHART_THEME.text, fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: CHART_THEME.tooltip.bg, border: `1px solid ${CHART_THEME.tooltip.border}`, color: CHART_THEME.tooltip.text, borderRadius: 6 }}
                      labelFormatter={formatWeekLabel}
                    />
                    <Line type="monotone" dataKey="created" stroke="#3b82f6" strokeWidth={2} dot={false} name="Created" />
                    <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} dot={false} name="Completed" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
