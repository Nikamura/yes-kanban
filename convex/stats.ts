import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { FIXED_COLUMNS } from "./lib/boardConstants";
import {
  aggregateFromRunAttempts,
  eachUtcDayInclusive,
  utcDayBoundsFromDayString,
  utcDayString,
} from "./tokenUsageAggregates";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

type ByAgentEntry = {
  agentConfigName: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  runCount: number;
};

type TokenUsageAcc = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  succeededRuns: number;
  failedRuns: number;
  timedOutRuns: number;
  abandonedRuns: number;
  totalRuns: number;
  byAgent: Map<string, ByAgentEntry>;
};

function emptyAcc(): TokenUsageAcc {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    succeededRuns: 0,
    failedRuns: 0,
    timedOutRuns: 0,
    abandonedRuns: 0,
    totalRuns: 0,
    byAgent: new Map(),
  };
}

function addDailyRows(rows: Doc<"tokenUsageDaily">[], acc: TokenUsageAcc) {
  for (const row of rows) {
    acc.totalInputTokens += row.inputTokens;
    acc.totalOutputTokens += row.outputTokens;
    acc.totalTokens += row.totalTokens;
    acc.totalCacheCreationTokens += row.cacheCreationTokens;
    acc.totalCacheReadTokens += row.cacheReadTokens;
    acc.succeededRuns += row.succeededRuns;
    acc.failedRuns += row.failedRuns;
    acc.timedOutRuns += row.timedOutRuns;
    acc.abandonedRuns += row.abandonedRuns ?? 0;
    acc.totalRuns += row.runCount;

    const existing =
      acc.byAgent.get(row.agentConfigName) ??
      ({
        agentConfigName: row.agentConfigName,
        model: row.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        runCount: 0,
      } satisfies ByAgentEntry);
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    existing.totalTokens += row.totalTokens;
    existing.cacheCreationTokens += row.cacheCreationTokens;
    existing.cacheReadTokens += row.cacheReadTokens;
    existing.runCount += row.runCount;
    if (row.model !== undefined) existing.model = row.model;
    acc.byAgent.set(row.agentConfigName, existing);
  }
}

function mergeAggregateIntoAcc(agg: ReturnType<typeof aggregateFromRunAttempts>, acc: TokenUsageAcc) {
  acc.totalInputTokens += agg.totalInputTokens;
  acc.totalOutputTokens += agg.totalOutputTokens;
  acc.totalTokens += agg.totalTokens;
  acc.totalCacheCreationTokens += agg.totalCacheCreationTokens;
  acc.totalCacheReadTokens += agg.totalCacheReadTokens;
  acc.succeededRuns += agg.succeededRuns;
  acc.failedRuns += agg.failedRuns;
  acc.timedOutRuns += agg.timedOutRuns;
  acc.abandonedRuns += agg.abandonedRuns;
  acc.totalRuns += agg.totalRuns;

  for (const [name, agentEntry] of agg.byAgentMap) {
    const cur =
      acc.byAgent.get(name) ??
      ({
        agentConfigName: agentEntry.agentConfigName,
        model: agentEntry.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        runCount: 0,
      } satisfies ByAgentEntry);
    cur.inputTokens += agentEntry.inputTokens;
    cur.outputTokens += agentEntry.outputTokens;
    cur.totalTokens += agentEntry.totalTokens;
    cur.cacheCreationTokens += agentEntry.cacheCreationTokens;
    cur.cacheReadTokens += agentEntry.cacheReadTokens;
    cur.runCount += agentEntry.runCount;
    if (agentEntry.model !== undefined) cur.model = agentEntry.model;
    acc.byAgent.set(name, cur);
  }
}

export const tokenUsage = query({
  args: {
    projectId: v.id("projects"),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const endTime = args.endTime ?? Date.now();
    const startTime = args.startTime ?? endTime - NINETY_DAYS_MS;

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const wsMap = new Map(workspaces.map((w) => [w._id, w]));

    // Intentionally unbounded by time: any project-scoped run switches this project to the
    // indexed path (even if older attempts lack projectId). Run backfillRunAttemptsProjectId
    // before relying on totals; until then, legacy fan-out still applies when this is null.
    const hasProjectScopedAttempt = await ctx.db
      .query("runAttempts")
      .withIndex("by_project_started", (q) => q.eq("projectId", args.projectId))
      .first();

    const agentConfigCache = new Map<Id<"agentConfigs">, { name: string; model?: string }>();

    async function ensureAgentConfig(configId: Id<"agentConfigs">) {
      if (agentConfigCache.has(configId)) return;
      const config = await ctx.db.get(configId);
      if (config && "name" in config) {
        agentConfigCache.set(configId, { name: config.name, model: config.model });
      } else {
        agentConfigCache.set(configId, { name: "Unknown" });
      }
    }

    async function ensureConfigsForAttempts(attempts: Doc<"runAttempts">[]) {
      for (const a of attempts) {
        const ws = wsMap.get(a.workspaceId);
        const id = a.agentConfigId ?? ws?.agentConfigId;
        if (id) await ensureAgentConfig(id);
      }
    }

    function buildRecentRuns(
      recentSource: Doc<"runAttempts">[],
      agentConfigs: Map<Id<"agentConfigs">, { name: string; model?: string }>
    ) {
      return recentSource.map((attempt) => {
        const ws = wsMap.get(attempt.workspaceId);
        const effectiveConfigId = attempt.agentConfigId ?? ws?.agentConfigId;
        const configInfo = effectiveConfigId ? agentConfigs.get(effectiveConfigId) : undefined;
        const agentConfigName = configInfo?.name ?? "Unknown";
        return {
          _id: attempt._id,
          attemptNumber: attempt.attemptNumber,
          type: attempt.type,
          status: attempt.status,
          inputTokens: attempt.tokenUsage?.inputTokens ?? 0,
          outputTokens: attempt.tokenUsage?.outputTokens ?? 0,
          totalTokens: attempt.tokenUsage?.totalTokens ?? 0,
          cacheCreationTokens: attempt.tokenUsage?.cacheCreationInputTokens ?? 0,
          cacheReadTokens: attempt.tokenUsage?.cacheReadInputTokens ?? 0,
          startedAt: attempt.startedAt,
          finishedAt: attempt.finishedAt,
          agentConfigName,
          workspaceStatus: ws?.status ?? "unknown",
        };
      });
    }

    // ── Legacy path: no runAttempts with projectId yet (pre-migration / tests without projectId)
    if (!hasProjectScopedAttempt) {
      const workspaceIds = workspaces.map((w) => w._id);
      const allAttempts: Doc<"runAttempts">[] = [];
      for (const wsId of workspaceIds) {
        const attempts = await ctx.db
          .query("runAttempts")
          .withIndex("by_workspace_started", (q) =>
            q.eq("workspaceId", wsId).gte("startedAt", startTime).lte("startedAt", endTime)
          )
          .collect();
        allAttempts.push(...attempts);
      }

      for (const w of workspaces) {
        await ensureAgentConfig(w.agentConfigId);
      }
      await ensureConfigsForAttempts(allAttempts);
      const agg = aggregateFromRunAttempts(allAttempts, wsMap, agentConfigCache);

      const recentSource = [...allAttempts].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
      const recentRuns = buildRecentRuns(recentSource, agentConfigCache);

      return {
        totalInputTokens: agg.totalInputTokens,
        totalOutputTokens: agg.totalOutputTokens,
        totalTokens: agg.totalTokens,
        totalCacheCreationTokens: agg.totalCacheCreationTokens,
        totalCacheReadTokens: agg.totalCacheReadTokens,
        byAgent: Array.from(agg.byAgentMap.values()),
        recentRuns,
        totalRuns: allAttempts.length,
        succeededRuns: agg.succeededRuns,
        failedRuns: agg.failedRuns,
        timedOutRuns: agg.timedOutRuns,
        abandonedRuns: agg.abandonedRuns,
      };
    }

    // ── Indexed path: daily aggregates + raw for partial UTC days (exact [startTime, endTime])
    const startDayStr = utcDayString(startTime);
    const endDayStr = utcDayString(endTime);

    const dailyRows = await ctx.db
      .query("tokenUsageDaily")
      .withIndex("by_project_day", (q) =>
        q.eq("projectId", args.projectId).gte("day", startDayStr).lte("day", endDayStr)
      )
      .collect();

    const dailyByDay = new Map<string, Doc<"tokenUsageDaily">[]>();
    for (const row of dailyRows) {
      const list = dailyByDay.get(row.day) ?? [];
      list.push(row);
      dailyByDay.set(row.day, list);
    }

    const acc = emptyAcc();

    for (const w of workspaces) {
      await ensureAgentConfig(w.agentConfigId);
    }

    for (const dayStr of eachUtcDayInclusive(startDayStr, endDayStr)) {
      const { dayStart, dayEnd } = utcDayBoundsFromDayString(dayStr);
      const fullDayInWindow = startTime <= dayStart && endTime >= dayEnd;
      const overlapStart = Math.max(startTime, dayStart);
      const overlapEnd = Math.min(endTime, dayEnd);
      if (overlapStart > overlapEnd) continue;

      if (fullDayInWindow) {
        const rows = dailyByDay.get(dayStr) ?? [];
        if (rows.length > 0) {
          // Trust pre-aggregated daily rows — avoids fetching all raw attempts per day
          // which can exceed the 16 MiB read limit on active projects.
          addDailyRows(rows, acc);
        } else {
          // No daily aggregate yet — fall back to raw run attempts for this day.
          const raw = await ctx.db
            .query("runAttempts")
            .withIndex("by_project_started", (q) =>
              q.eq("projectId", args.projectId).gte("startedAt", dayStart).lte("startedAt", dayEnd)
            )
            .collect();
          await ensureConfigsForAttempts(raw);
          mergeAggregateIntoAcc(aggregateFromRunAttempts(raw, wsMap, agentConfigCache), acc);
        }
      } else {
        // Partial day (edge of window) — always use raw attempts for precision.
        const raw = await ctx.db
          .query("runAttempts")
          .withIndex("by_project_started", (q) =>
            q.eq("projectId", args.projectId).gte("startedAt", overlapStart).lte("startedAt", overlapEnd)
          )
          .collect();
        await ensureConfigsForAttempts(raw);
        mergeAggregateIntoAcc(aggregateFromRunAttempts(raw, wsMap, agentConfigCache), acc);
      }
    }

    // Recent runs: newest in [startTime, endTime] (same as legacy), up to 20
    let recentAttempts = await ctx.db
      .query("runAttempts")
      .withIndex("by_project_started", (q) =>
        q.eq("projectId", args.projectId).gte("startedAt", startTime).lte("startedAt", endTime)
      )
      .order("desc")
      .take(20);

    if (recentAttempts.length === 0) {
      const workspaceIds = workspaces.map((w) => w._id);
      const pooled: Doc<"runAttempts">[] = [];
      for (const wsId of workspaceIds) {
        const batch = await ctx.db
          .query("runAttempts")
          .withIndex("by_workspace_started", (q) =>
            q.eq("workspaceId", wsId).gte("startedAt", startTime).lte("startedAt", endTime)
          )
          .collect();
        pooled.push(...batch);
      }
      recentAttempts = pooled.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
    }

    await ensureConfigsForAttempts(recentAttempts);
    const recentRuns = buildRecentRuns(recentAttempts, agentConfigCache);

    return {
      totalInputTokens: acc.totalInputTokens,
      totalOutputTokens: acc.totalOutputTokens,
      totalTokens: acc.totalTokens,
      totalCacheCreationTokens: acc.totalCacheCreationTokens,
      totalCacheReadTokens: acc.totalCacheReadTokens,
      byAgent: Array.from(acc.byAgent.values()),
      recentRuns,
      totalRuns: acc.totalRuns,
      succeededRuns: acc.succeededRuns,
      failedRuns: acc.failedRuns,
      timedOutRuns: acc.timedOutRuns,
      abandonedRuns: acc.abandonedRuns,
    };
  },
});

const HISTORY_LIMIT = 10000;

export const analyticsData = query({
  args: {
    projectId: v.id("projects"),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const endTime = args.endTime ?? Date.now();
    const startTime = args.startTime ?? endTime - NINETY_DAYS_MS;

    // Fetch history within time range using index
    const history = await ctx.db
      .query("issueHistory")
      .withIndex("by_project_time", (q) =>
        q.eq("projectId", args.projectId).gte("timestamp", startTime).lte("timestamp", endTime)
      )
      .order("asc")
      .take(HISTORY_LIMIT);

    // Filter to only "created" and status-change actions ("moved" or "updated")
    const filtered = history.filter(
      (h) => h.action === "created" || ((h.action === "moved" || h.action === "updated") && h.field === "status")
    );

    // Collect unique issue IDs from history
    const issueIdSet = new Set<Id<"issues">>();
    for (const h of filtered) {
      issueIdSet.add(h.issueId);
    }

    // Fetch issue metadata
    const issueMetadata: Record<string, {
      simpleId: string;
      tags: string[];
      createdAt: number;
      currentStatus: string;
    }> = {};
    for (const issueId of issueIdSet) {
      const issue = await ctx.db.get(issueId);
      if (issue) {
        issueMetadata[issueId] = {
          simpleId: issue.simpleId,
          tags: issue.tags,
          createdAt: issue.createdAt,
          currentStatus: issue.status,
        };
      }
    }

    // Fetch columns for this project
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const fixedSet = new Set<string>(FIXED_COLUMNS);
    const orderedColumns = columns
      .filter((c) => fixedSet.has(c.name))
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ name: c.name, color: c.color, position: c.position }));

    return {
      history: filtered.map((h) => ({
        issueId: h.issueId,
        action: h.action,
        field: h.field,
        oldValue: h.oldValue,
        newValue: h.newValue,
        timestamp: h.timestamp,
      })),
      issueMetadata,
      columns: orderedColumns,
      truncated: history.length >= HISTORY_LIMIT,
    };
  },
});
