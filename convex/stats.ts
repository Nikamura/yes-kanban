import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const tokenUsage = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const workspaceIds = workspaces.map((w) => w._id);

    // Fetch all run attempts for all workspaces in this project
    const allAttempts = [];
    for (const wsId of workspaceIds) {
      const attempts = await ctx.db
        .query("runAttempts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
        .collect();
      allAttempts.push(...attempts);
    }

    // Aggregate totals
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let succeededRuns = 0;
    let failedRuns = 0;
    let timedOutRuns = 0;

    for (const attempt of allAttempts) {
      if (attempt.tokenUsage) {
        totalInputTokens += attempt.tokenUsage.inputTokens;
        totalOutputTokens += attempt.tokenUsage.outputTokens;
        totalTokens += attempt.tokenUsage.totalTokens;
        totalCacheCreationTokens += attempt.tokenUsage.cacheCreationInputTokens ?? 0;
        totalCacheReadTokens += attempt.tokenUsage.cacheReadInputTokens ?? 0;
      }
      if (attempt.status === "succeeded") succeededRuns++;
      else if (attempt.status === "failed") failedRuns++;
      else if (attempt.status === "timed_out") timedOutRuns++;
    }

    // Build workspace lookup and agent config lookup
    const wsMap = new Map(workspaces.map((w) => [w._id, w]));
    const agentConfigIds = Array.from(new Set(workspaces.map((w) => w.agentConfigId)));
    const agentConfigs = new Map<string, { name: string; model?: string }>();
    for (const configId of agentConfigIds) {
      const config = await ctx.db.get(configId);
      if (config && "name" in config) {
        agentConfigs.set(configId, { name: config.name, model: config.model });
      }
    }

    // Aggregate by agent config
    const byAgentMap = new Map<
      string,
      {
        agentConfigName: string;
        model?: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        runCount: number;
      }
    >();

    for (const attempt of allAttempts) {
      const ws = wsMap.get(attempt.workspaceId);
      if (!ws) continue;
      const configInfo = agentConfigs.get(ws.agentConfigId);
      const configName = configInfo?.name ?? "Unknown";
      const existing = byAgentMap.get(configName) ?? {
        agentConfigName: configName,
        model: configInfo?.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        runCount: 0,
      };
      if (attempt.tokenUsage) {
        existing.inputTokens += attempt.tokenUsage.inputTokens;
        existing.outputTokens += attempt.tokenUsage.outputTokens;
        existing.totalTokens += attempt.tokenUsage.totalTokens;
        existing.cacheCreationTokens += attempt.tokenUsage.cacheCreationInputTokens ?? 0;
        existing.cacheReadTokens += attempt.tokenUsage.cacheReadInputTokens ?? 0;
      }
      existing.runCount++;
      byAgentMap.set(configName, existing);
    }

    // Recent runs: last 20 sorted by startedAt desc
    const sorted = [...allAttempts].sort((a, b) => b.startedAt - a.startedAt);
    const recentRuns = sorted.slice(0, 20).map((attempt) => {
      const ws = wsMap.get(attempt.workspaceId);
      const configInfo = ws ? agentConfigs.get(ws.agentConfigId) : undefined;
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

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCacheCreationTokens,
      totalCacheReadTokens,
      byAgent: Array.from(byAgentMap.values()),
      recentRuns,
      totalRuns: allAttempts.length,
      succeededRuns,
      failedRuns,
      timedOutRuns,
    };
  },
});

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 10000;

export const analyticsData = query({
  args: {
    projectId: v.id("projects"),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const endTime = args.endTime ?? Date.now();
    const startTime = args.startTime ?? (endTime - NINETY_DAYS_MS);

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
      priority?: string;
      createdAt: number;
      currentStatus: string;
    }> = {};
    for (const issueId of issueIdSet) {
      const issue = await ctx.db.get(issueId);
      if (issue) {
        issueMetadata[issueId] = {
          simpleId: issue.simpleId,
          tags: issue.tags,
          priority: issue.priority,
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

    const orderedColumns = columns
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
