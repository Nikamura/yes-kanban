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
}

export function useAnalyticsData(filters: Filters) {
  const [stableNow] = useState(() => Date.now());

  const data = useQuery(api.stats.analyticsData, {
    projectId: filters.projectId,
    startTime: filters.startTime,
    endTime: filters.endTime,
  });

  const filteredIssueIds = useMemo(() => {
    if (!data) return new Set<string>();
    const ids = new Set<string>();
    for (const [id, meta] of Object.entries(data.issueMetadata)) {
      if (filters.tags && filters.tags.length > 0) {
        if (!filters.tags.some((t) => meta.tags.includes(t))) continue;
      }
      ids.add(id);
    }
    return ids;
  }, [data, filters.tags]);

  const filteredHistory = useMemo(() => {
    if (!data) return [];
    return data.history.filter((h) => filteredIssueIds.has(h.issueId));
  }, [data, filteredIssueIds]);

  const availableTags = useMemo(() => {
    if (!data) return [] as string[];
    const tags = new Set<string>();
    for (const meta of Object.values(data.issueMetadata)) {
      for (const t of meta.tags) tags.add(t);
    }
    return [...tags].sort();
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
    cycleTimeData,
    throughputData,
    cumulativeFlowData,
    avgTimePerColumn,
    createdVsCompleted,
    summary,
  };
}
