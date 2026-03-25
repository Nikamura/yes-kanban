import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, CartesianGrid,
} from "recharts";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";

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
  const parts = week.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return week;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AnalyticsDashboard({ projectId }: { projectId: Id<"projects"> }) {
  const [presetDays, setPresetDays] = useState(90);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
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
    isLoading, truncated, columns, availableTags,
    cycleTimeData, throughputData, cumulativeFlowData,
    avgTimePerColumn, createdVsCompleted, summary,
  } = useAnalyticsData({
    projectId,
    ...timeRange,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-8 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading analytics...
      </div>
    );
  }

  const hasData = summary.totalCreated > 0 || summary.totalCompleted > 0;

  const statCard = "rounded-lg border border-border bg-card p-3";
  const statLabel = "text-xs font-medium text-muted-foreground";
  const statValue = "font-mono text-lg font-semibold text-foreground";
  const statDetail = "mt-1 text-xs text-muted-foreground";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Range:</span>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant={presetDays === p.days && !customStart && !customEnd ? "default" : "outline"}
                onClick={() => { setPresetDays(p.days); setCustomStart(""); setCustomEnd(""); }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Input
            type="date"
            className="h-9 w-[140px]"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            className="h-9 w-[140px]"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </div>
        {availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Tags:</span>
            <select
              className="min-h-[120px] min-w-[160px] rounded-md border border-input bg-background px-2 py-1 text-sm"
              multiple
              value={selectedTags}
              onChange={(e) => setSelectedTags(Array.from(e.target.selectedOptions, (o) => o.value))}
            >
              {availableTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {truncated && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          Results limited to 10,000 history records. Try narrowing the date range for complete data.
        </div>
      )}

      {!hasData ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          No issue data in the selected time range. Create and move issues through columns to see analytics.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={statCard}>
              <div className={statLabel}>Avg Cycle Time</div>
              <div className={statValue}>
                {summary.avgCycleTime > 0 ? `${summary.avgCycleTime}d` : "-"}
              </div>
              <div className={statDetail}>In Progress to Done</div>
            </div>
            <div className={statCard}>
              <div className={statLabel}>Throughput / Week</div>
              <div className={statValue}>{summary.throughputPerWeek}</div>
              <div className={statDetail}>cards completed</div>
            </div>
            <div className={statCard}>
              <div className={statLabel}>Total Created</div>
              <div className={statValue}>{summary.totalCreated}</div>
            </div>
            <div className={statCard}>
              <div className={statLabel}>Total Completed</div>
              <div className={statValue}>{summary.totalCompleted}</div>
            </div>
          </div>

          {/* Cycle Time Trend */}
          {cycleTimeData.trend.length > 0 && (
            <div className="mb-8">
              <h3 className="mb-2 text-base font-semibold">Cycle Time Trend (days)</h3>
              <div className="h-[250px] w-full">
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
            <div className="mb-8">
              <h3 className="mb-2 flex flex-wrap items-center gap-2 text-base font-semibold">
                Throughput
                <span className="ml-2 inline-flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={throughputMode === "weekly" ? "default" : "outline"}
                    onClick={() => setThroughputMode("weekly")}
                  >Weekly</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={throughputMode === "monthly" ? "default" : "outline"}
                    onClick={() => setThroughputMode("monthly")}
                  >Monthly</Button>
                </span>
              </h3>
              <div className="h-[250px] w-full">
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
            <div className="mb-8">
              <h3 className="mb-2 text-base font-semibold">Cumulative Flow</h3>
              <div className="h-[300px] w-full">
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
            <div className="mb-8">
              <h3 className="mb-2 text-base font-semibold">Average Time per Column (days)</h3>
              <div className="w-full" style={{ height: Math.max(200, avgTimePerColumn.length * 40) }}>
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
            <div className="mb-8">
              <h3 className="mb-2 text-base font-semibold">Created vs Completed</h3>
              <div className="h-[250px] w-full">
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
