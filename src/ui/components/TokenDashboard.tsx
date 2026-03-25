import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/ui/components/ui/badge";
import { cn } from "@/ui/lib/utils";
import { wsRunAttemptStatusClass } from "@/ui/lib/wsUi";

// Pricing per million tokens by model family
const MODEL_PRICING = {
  sonnet: { input: 3, cacheCreation: 3.75, cacheRead: 0.3, output: 15 },
  opus: { input: 15, cacheCreation: 18.75, cacheRead: 1.5, output: 75 },
  haiku: { input: 0.8, cacheCreation: 1.0, cacheRead: 0.08, output: 4 },
} as const;

type ModelPricing = (typeof MODEL_PRICING)[keyof typeof MODEL_PRICING];

const DEFAULT_PRICING: ModelPricing = MODEL_PRICING.sonnet;

function getPricing(model?: string): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return MODEL_PRICING.opus;
  if (lower.includes("haiku")) return MODEL_PRICING.haiku;
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
  pricing: ModelPricing = DEFAULT_PRICING,
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

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-8 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading...
      </div>
    );
  }

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

  const maxAgentTokens = Math.max(
    ...data.byAgent.map((a) => a.inputTokens + a.outputTokens + a.cacheReadTokens),
    1,
  );

  const card = "rounded-lg border border-border bg-card p-3";
  const label = "text-xs font-medium text-muted-foreground";
  const value = "font-mono text-lg font-semibold tracking-tight text-foreground";
  const detail = "mt-1 text-xs text-muted-foreground";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <h2 className="mb-4 text-xl font-semibold">Token Usage Dashboard</h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={card}>
          <div className={label}>Total Tokens</div>
          <div className={value}>{formatTokens(data.totalTokens)}</div>
          <div className={detail}>
            {formatTokens(data.totalInputTokens)} in / {formatTokens(data.totalOutputTokens)} out
          </div>
          {(data.totalCacheCreationTokens > 0 || data.totalCacheReadTokens > 0) && (
            <div className={detail}>
              {formatTokens(data.totalCacheCreationTokens)} cache write / {formatTokens(data.totalCacheReadTokens)} cache read
            </div>
          )}
        </div>
        <div className={card}>
          <div className={label}>Estimated Cost</div>
          <div className={value}>{formatCost(totalCost)}</div>
          <div className={detail}>
            across {data.totalRuns} runs
          </div>
        </div>
        <div className={card}>
          <div className={label}>Total Runs</div>
          <div className={value}>{data.totalRuns}</div>
          <div className={detail}>
            {data.succeededRuns} succeeded
          </div>
        </div>
        {cacheSavings > 0 && (
          <div className={cn(card, "border-emerald-500/30 bg-emerald-500/5")}>
            <div className={label}>Cache Savings</div>
            <div className={value}>{formatCost(cacheSavings)}</div>
            <div className={detail}>
              {formatTokens(data.totalCacheReadTokens)} tokens served from cache
            </div>
          </div>
        )}
        <div className={cn(card, "border-emerald-500/30 bg-emerald-500/5")}>
          <div className={label}>Succeeded</div>
          <div className={value}>{data.succeededRuns}</div>
        </div>
        <div className={cn(card, "border-destructive/30 bg-destructive/5")}>
          <div className={label}>Failed</div>
          <div className={value}>{data.failedRuns}</div>
        </div>
        <div className={cn(card, "border-amber-500/30 bg-amber-500/5")}>
          <div className={label}>Timed Out</div>
          <div className={value}>{data.timedOutRuns}</div>
        </div>
        {data.abandonedRuns > 0 && (
          <div className={card}>
            <div className={label}>Abandoned</div>
            <div className={value}>{data.abandonedRuns}</div>
          </div>
        )}
      </div>

      {data.byAgent.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-base font-semibold">Usage by Agent</h3>
          <div className="space-y-4">
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
                  <div key={agent.agentConfigName} className="space-y-1">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                      <span className="font-medium">{agent.agentConfigName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatTokens(agent.totalTokens)} tokens / {agent.runCount} runs
                        {agent.cacheReadTokens > 0 && ` / ${formatTokens(agent.cacheReadTokens)} cached`}
                      </span>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="absolute top-0 left-0 h-full rounded-l-full bg-blue-500"
                        style={{
                          width: `${(agent.inputTokens / maxAgentTokens) * 100}%`,
                        }}
                      />
                      <div
                        className="absolute top-0 h-full bg-violet-500"
                        style={{
                          width: `${(agent.outputTokens / maxAgentTokens) * 100}%`,
                          left: `${(agent.inputTokens / maxAgentTokens) * 100}%`,
                        }}
                      />
                      {agent.cacheReadTokens > 0 && (
                        <div
                          className="absolute top-0 h-full bg-emerald-500"
                          style={{
                            width: `${(agent.cacheReadTokens / maxAgentTokens) * 100}%`,
                            left: `${((agent.inputTokens + agent.outputTokens) / maxAgentTokens) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {formatCost(agentCost)}
                    </div>
                  </div>
                );
              })}
            <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-sm bg-blue-500" /> Input
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-sm bg-violet-500" /> Output
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-sm bg-emerald-500" /> Cache Read
              </span>
            </div>
          </div>
        </div>
      )}

      {data.recentRuns.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-base font-semibold">Recent Runs</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm" data-testid="dashboard-table">
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <th className="p-2 font-mono text-xs">#</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Agent</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Input</th>
                  <th className="p-2">Output</th>
                  <th className="p-2">Cache</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">Duration</th>
                  <th className="p-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run._id} className="border-b border-border last:border-0">
                    <td className="p-2 font-mono text-xs">{run.attemptNumber}</td>
                    <td className="p-2">
                      <Badge variant="secondary" className={cn("font-mono text-[10px]", wsRunAttemptStatusClass(run.status))}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="p-2">{run.agentConfigName}</td>
                    <td className="p-2">{run.type}</td>
                    <td className="p-2 font-mono text-xs">{formatTokens(run.inputTokens)}</td>
                    <td className="p-2 font-mono text-xs">{formatTokens(run.outputTokens)}</td>
                    <td className="p-2 font-mono text-xs">
                      {run.cacheReadTokens > 0 ? formatTokens(run.cacheReadTokens) : "-"}
                    </td>
                    <td className="p-2 font-mono text-xs">{formatTokens(run.totalTokens)}</td>
                    <td className="p-2 font-mono text-xs">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{formatTime(run.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.totalRuns === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          No run data yet. Token usage will appear here once agents start running.
        </div>
      )}
    </div>
  );
}
