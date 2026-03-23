import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export function utcDayString(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function utcStartOfUtcDayMs(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function utcEndOfUtcDayMs(ts: number): number {
  return utcStartOfUtcDayMs(ts) + 24 * 60 * 60 * 1000 - 1;
}

function parseYmdParts(dayStr: string): { y: number; m: number; d: number } {
  const parts = dayStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) {
    throw new Error(`Invalid YYYY-MM-DD day string: ${dayStr}`);
  }
  return { y, m, d };
}

export function utcDayBoundsFromDayString(dayStr: string): { dayStart: number; dayEnd: number } {
  const { y, m, d } = parseYmdParts(dayStr);
  const dayStart = Date.UTC(y, m - 1, d);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  return { dayStart, dayEnd };
}

function addUtcDays(dayStr: string, deltaDays: number): string {
  const { y, m, d } = parseYmdParts(dayStr);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 24 * 60 * 60 * 1000;
  return utcDayString(t);
}

/** Inclusive iteration from startDay to endDay (YYYY-MM-DD). */
export function* eachUtcDayInclusive(startDay: string, endDay: string): Generator<string> {
  let cur = startDay;
  while (cur <= endDay) {
    yield cur;
    cur = addUtcDays(cur, 1);
  }
}

export type TokenUsageFields = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export async function upsertTokenUsageDailyForTerminalAttempt(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    agentConfigId: Id<"agentConfigs">;
    agentConfigName: string;
    model?: string;
    startedAt: number;
    status: string;
    tokenUsage?: TokenUsageFields;
  }
): Promise<void> {
  const day = utcDayString(args.startedAt);
  const existing = await ctx.db
    .query("tokenUsageDaily")
    .withIndex("by_project_agent_day", (q) =>
      q.eq("projectId", args.projectId).eq("agentConfigId", args.agentConfigId).eq("day", day)
    )
    .first();

  const inputDelta = args.tokenUsage?.inputTokens ?? 0;
  const outputDelta = args.tokenUsage?.outputTokens ?? 0;
  const totalDelta = args.tokenUsage?.totalTokens ?? 0;
  const cacheCreateDelta = args.tokenUsage?.cacheCreationInputTokens ?? 0;
  const cacheReadDelta = args.tokenUsage?.cacheReadInputTokens ?? 0;

  const succeededDelta = args.status === "succeeded" ? 1 : 0;
  const failedDelta = args.status === "failed" ? 1 : 0;
  const timedOutDelta = args.status === "timed_out" ? 1 : 0;
  const abandonedDelta = args.status === "abandoned" ? 1 : 0;

  if (existing) {
    await ctx.db.patch(existing._id, {
      agentConfigName: args.agentConfigName,
      model: args.model,
      inputTokens: existing.inputTokens + inputDelta,
      outputTokens: existing.outputTokens + outputDelta,
      totalTokens: existing.totalTokens + totalDelta,
      cacheCreationTokens: existing.cacheCreationTokens + cacheCreateDelta,
      cacheReadTokens: existing.cacheReadTokens + cacheReadDelta,
      runCount: existing.runCount + 1,
      succeededRuns: existing.succeededRuns + succeededDelta,
      failedRuns: existing.failedRuns + failedDelta,
      timedOutRuns: existing.timedOutRuns + timedOutDelta,
      abandonedRuns: (existing.abandonedRuns ?? 0) + abandonedDelta,
    });
    return;
  }

  await ctx.db.insert("tokenUsageDaily", {
    projectId: args.projectId,
    day,
    agentConfigId: args.agentConfigId,
    agentConfigName: args.agentConfigName,
    model: args.model,
    inputTokens: inputDelta,
    outputTokens: outputDelta,
    totalTokens: totalDelta,
    cacheCreationTokens: cacheCreateDelta,
    cacheReadTokens: cacheReadDelta,
    runCount: 1,
    succeededRuns: succeededDelta,
    failedRuns: failedDelta,
    timedOutRuns: timedOutDelta,
    abandonedRuns: abandonedDelta,
  });
}

export function aggregateFromRunAttempts(
  attempts: Doc<"runAttempts">[],
  wsMap: Map<Id<"workspaces">, Doc<"workspaces">>,
  agentConfigs: Map<Id<"agentConfigs">, { name: string; model?: string }>
) {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let succeededRuns = 0;
  let failedRuns = 0;
  let timedOutRuns = 0;
  let abandonedRuns = 0;

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

  for (const attempt of attempts) {
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
    else if (attempt.status === "abandoned") abandonedRuns++;

    const ws = wsMap.get(attempt.workspaceId);
    if (!ws) continue;
    const effectiveConfigId = attempt.agentConfigId ?? ws.agentConfigId;
    const configInfo = agentConfigs.get(effectiveConfigId);
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

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    succeededRuns,
    failedRuns,
    timedOutRuns,
    abandonedRuns,
    totalRuns: attempts.length,
    byAgentMap,
  };
}
