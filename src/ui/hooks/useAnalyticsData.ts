import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  computeCycleTime, computeThroughput, computeCreatedVsCompleted, computeSummary,
  computeCumulativeFlow, computeAvgTimePerColumn,
} from "../utils/analyticsCalculations";

interface Filters {
  projectId: Id<"projects">;
  startTime?: number;
  endTime?: number;
  tags?: string[];
  priority?: string;
}

export function useAnalyticsData(filters: Filters) {
  const [stableNow] = useState(() => Date.now());

  const data = useQuery(api.stats.analyticsData, {
    projectId: filters.projectId,
    startTime: filters.startTime,
    endTime: filters.endTime,
  });

  // Filter issues by tags and priority client-side
  const filteredIssueIds = useMemo(() => {
    if (!data) return new Set<string>();
    const ids = new Set<string>();
    for (const [id, meta] of Object.entries(data.issueMetadata)) {
      if (filters.priority && meta.priority !== filters.priority) continue;
      if (filters.tags && filters.tags.length > 0) {
        if (!filters.tags.some((t) => meta.tags.includes(t))) continue;
      }
      ids.add(id);
    }
    return ids;
  }, [data, filters.priority, filters.tags]);

  const filteredHistory = useMemo(() => {
    if (!data) return [];
    return data.history.filter((h) => filteredIssueIds.has(h.issueId));
  }, [data, filteredIssueIds]);

  // All unique tags and priorities for filter dropdowns (single pass)
  const { availableTags, availablePriorities } = useMemo(() => {
    if (!data) return { availableTags: [] as string[], availablePriorities: [] as string[] };
    const tags = new Set<string>();
    const pris = new Set<string>();
    for (const meta of Object.values(data.issueMetadata)) {
      for (const t of meta.tags) tags.add(t);
      if (meta.priority) pris.add(meta.priority);
    }
    return { availableTags: [...tags].sort(), availablePriorities: [...pris].sort() };
  }, [data]);

  const columns = useMemo(() => data?.columns ?? [], [data]);

  const cycleTimeData = useMemo(
    () => computeCycleTime(filteredHistory, columns),
    [filteredHistory, columns],
  );

  const throughputData = useMemo(
    () => computeThroughput(filteredHistory, columns),
    [filteredHistory, columns],
  );

  const endTimeResolved = filters.endTime ?? stableNow;

  const cumulativeFlowData = useMemo(
    () => computeCumulativeFlow(filteredHistory, columns, endTimeResolved),
    [filteredHistory, columns, endTimeResolved],
  );

  const avgTimePerColumn = useMemo(
    () => computeAvgTimePerColumn(filteredHistory, columns, endTimeResolved),
    [filteredHistory, columns, endTimeResolved],
  );

  const createdVsCompleted = useMemo(
    () => computeCreatedVsCompleted(filteredHistory, columns),
    [filteredHistory, columns],
  );

  const summary = useMemo(
    () => computeSummary(filteredHistory, columns, cycleTimeData.average, filters.startTime, endTimeResolved),
    [filteredHistory, columns, cycleTimeData.average, filters.startTime, endTimeResolved],
  );

  return {
    isLoading: data === undefined,
    truncated: data?.truncated ?? false,
    columns,
    availableTags,
    availablePriorities,
    cycleTimeData,
    throughputData,
    cumulativeFlowData,
    avgTimePerColumn,
    createdVsCompleted,
    summary,
  };
}
