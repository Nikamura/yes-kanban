import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalMutation } from "./_generated/server";
import { upsertTokenUsageDailyForTerminalAttempt } from "./tokenUsageAggregates.js";

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
});

// Registered via internalMutationGeneric — on `internal.migrations.run` only, not `api`.
// bunx convex run migrations:run '{"fn":"migrations:myMigration"}'
export const run = migrations.runner();

export const backfillRunAttemptsProjectId = migrations.define({
  table: "runAttempts",
  migrateOne: async (ctx, doc) => {
    if (doc.projectId !== undefined) return;
    const ws = await ctx.db.get(doc.workspaceId);
    if (!ws) return;
    return { projectId: ws.projectId };
  },
});

export const backfillTokenUsageDaily = migrations.define({
  table: "runAttempts",
  migrateOne: async (ctx, doc) => {
    if (doc.tokenUsageDailyBackfilled) return;
    if (!doc.finishedAt || doc.status === "running") return;
    if (!doc.projectId) return;
    const ws = await ctx.db.get(doc.workspaceId);
    if (!ws) return;
    const effectiveAgentConfigId = doc.agentConfigId ?? ws.agentConfigId;
    const agentConfig = await ctx.db.get(effectiveAgentConfigId);
    await upsertTokenUsageDailyForTerminalAttempt(ctx, {
      projectId: doc.projectId,
      agentConfigId: effectiveAgentConfigId,
      agentConfigName: agentConfig?.name ?? "Unknown",
      model: agentConfig?.model,
      startedAt: doc.startedAt,
      status: doc.status,
      tokenUsage: doc.tokenUsage,
    });
    return { tokenUsageDailyBackfilled: true };
  },
});

export const removeChecklistFromIssues = migrations.define({
  table: "issues",
  migrateOne: (_ctx, doc) => {
    if (doc.checklist === undefined) return;
    return { checklist: undefined };
  },
});

/** YES-255: Remove per-project skills; run before dropping the `skills` table from schema. */
export const deleteAllSkills = migrations.define({
  table: "skills",
  migrateOne: async (ctx, doc) => {
    await ctx.db.delete(doc._id);
  },
});

/** YES-255: Remove tool-pattern sandboxing from agent configs. */
export const clearAllowedToolPatterns = migrations.define({
  table: "agentConfigs",
  migrateOne: () => ({ allowedToolPatterns: undefined }),
});

/** YES-258: Remove disableBuiltInMcp from projects (field was removed from code but left in DB). */
export const removeDisableBuiltInMcp = migrations.define({
  table: "projects",
  migrateOne: (_ctx, doc) => {
    const legacy = doc as DataModel["projects"]["document"] & {
      disableBuiltInMcp?: boolean;
    };
    if (legacy.disableBuiltInMcp === undefined) return;
    // Patch shape is validated at runtime; field is absent from current generated types.
    return { disableBuiltInMcp: undefined } as Partial<DataModel["projects"]["document"]>;
  },
});

/** Serial order for `runAll`. `backfillTokenUsageDaily` requires `projectId` on runAttempts. */
export function runAllSerialMigrations() {
  return [
    internal.migrations.backfillRunAttemptsProjectId,
    internal.migrations.backfillTokenUsageDaily,
    internal.migrations.removeChecklistFromIssues,
    internal.migrations.deleteAllSkills,
    internal.migrations.clearAllowedToolPatterns,
    internal.migrations.removeDisableBuiltInMcp,
  ] as const;
}

// Run all migrations in order. Append new migrations inside `runAllSerialMigrations` in chronological order.
// Uses runSerially so an empty list is a no-op (runner([]) from the component cannot be used with zero migrations).
// Internal mutation (not exposed on `api`). `convex run` and `bun run migrate` use the deployment admin key and may invoke it.
// bunx convex run migrations:runAll
export const runAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    await migrations.runSerially(ctx, [...runAllSerialMigrations()]);
  },
});
