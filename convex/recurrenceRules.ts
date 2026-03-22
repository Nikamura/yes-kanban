import { v } from "convex/values";
import { mutation, query, internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { validateCron, getNextOccurrence } from "./lib/cronParser";
import { TERMINAL_COLUMN_NAMES } from "./workspaces";

// --- Queries ---

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("recurrenceRules")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("recurrenceRules") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByIssueId = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue?.recurrenceRuleId) return null;
    return await ctx.db.get(issue.recurrenceRuleId);
  },
});

// --- Mutations ---

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.string(),
    priority: v.optional(v.string()),
    tags: v.array(v.string()),
    targetColumn: v.string(),
    triggerMode: v.union(v.literal("fixed"), v.literal("on_completion")),
    cronExpression: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.triggerMode === "fixed") {
      const cron = args.cronExpression;
      if (!cron) throw new Error("cronExpression is required for fixed trigger mode");
      const err = validateCron(cron);
      if (err) throw new Error(`Invalid cron expression: ${err}`);
    }

    const now = Date.now();
    let nextDueAt: number | undefined;
    if (args.triggerMode === "fixed" && args.cronExpression) {
      nextDueAt = getNextOccurrence(args.cronExpression, now);
    }

    const ruleId = await ctx.db.insert("recurrenceRules", {
      projectId: args.projectId,
      title: args.title,
      description: args.description,
      priority: args.priority,
      tags: args.tags,
      targetColumn: args.targetColumn,
      triggerMode: args.triggerMode,
      cronExpression: args.cronExpression,
      status: "active",
      nextDueAt,
      spawnCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // For on_completion, spawn the first issue immediately
    if (args.triggerMode === "on_completion") {
      const rule = await ctx.db.get(ruleId);
      if (rule) {
        await spawnRecurringIssue(ctx, rule);
      }
    }

    return ruleId;
  },
});

export const update = mutation({
  args: {
    id: v.id("recurrenceRules"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    targetColumn: v.optional(v.string()),
    cronExpression: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Recurrence rule not found");

    if (args.cronExpression !== undefined) {
      const err = validateCron(args.cronExpression);
      if (err) throw new Error(`Invalid cron expression: ${err}`);
    }

    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );

    if (Object.keys(filtered).length > 0) {
      const patch: Record<string, unknown> = { ...filtered, updatedAt: Date.now() };

      // Recompute nextDueAt if cron changed on a fixed rule
      if (existing.triggerMode === "fixed" && args.cronExpression) {
        patch["nextDueAt"] = getNextOccurrence(args.cronExpression, Date.now());
      }

      await ctx.db.patch(id, patch);
    }
  },
});

export const pause = mutation({
  args: { id: v.id("recurrenceRules") },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.id);
    if (!rule) throw new Error("Recurrence rule not found");
    await ctx.db.patch(args.id, { status: "paused", updatedAt: Date.now() });
  },
});

export const resume = mutation({
  args: { id: v.id("recurrenceRules") },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.id);
    if (!rule) throw new Error("Recurrence rule not found");

    const patch: Record<string, unknown> = { status: "active", updatedAt: Date.now() };

    // For fixed mode, recompute nextDueAt from now
    if (rule.triggerMode === "fixed" && rule.cronExpression) {
      patch["nextDueAt"] = getNextOccurrence(rule.cronExpression, Date.now());
    }

    await ctx.db.patch(args.id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("recurrenceRules") },
  handler: async (ctx, args) => {
    // Clear recurrenceRuleId on any issues linked to this rule
    const linkedIssues = await ctx.db
      .query("issues")
      .withIndex("by_recurrenceRuleId", (q) => q.eq("recurrenceRuleId", args.id))
      .collect();
    for (const issue of linkedIssues) {
      await ctx.db.patch(issue._id, { recurrenceRuleId: undefined });
    }
    await ctx.db.delete(args.id);
  },
});

// --- Spawn Logic ---

async function spawnRecurringIssue(
  ctx: MutationCtx,
  rule: Doc<"recurrenceRules">,
) {
  const project = await ctx.db.get(rule.projectId);
  if (!project) return;

  // Resolve target column — fall back to first visible column
  const columns = await ctx.db
    .query("columns")
    .withIndex("by_project", (q) => q.eq("projectId", rule.projectId))
    .collect();
  const visibleColumns = columns
    .filter((c) => c.visible)
    .sort((a, b) => a.position - b.position);
  const targetCol = visibleColumns.find((c) => c.name === rule.targetColumn);
  const columnName = targetCol?.name ?? visibleColumns[0]?.name;
  if (!columnName) return;

  // Generate simpleId
  const simpleId = `${project.simpleIdPrefix}-${project.simpleIdCounter}`;
  await ctx.db.patch(rule.projectId, {
    simpleIdCounter: project.simpleIdCounter + 1,
  });

  // Replace placeholders in title
  const seq = rule.spawnCount + 1;
  const dateStr = new Date().toISOString().slice(0, 10);
  const title = rule.title
    .replace(/\{\{seq\}\}/g, String(seq))
    .replace(/\{\{date\}\}/g, dateStr);

  // Get max position in target column
  const existingInColumn = await ctx.db
    .query("issues")
    .withIndex("by_project_status", (q) =>
      q.eq("projectId", rule.projectId).eq("status", columnName)
    )
    .collect();
  const maxPos = existingInColumn.reduce((max, i) => Math.max(max, i.position), -1);

  const now = Date.now();
  const issueId = await ctx.db.insert("issues", {
    projectId: rule.projectId,
    simpleId,
    title,
    description: rule.description,
    status: columnName,
    priority: rule.priority,
    tags: rule.tags,
    recurrenceRuleId: rule._id,
    position: maxPos + 1,
    createdAt: now,
    updatedAt: now,
  });

  // Update the rule
  await ctx.db.patch(rule._id, {
    currentIssueId: issueId,
    spawnCount: seq,
    updatedAt: now,
  });

  // Check if target column has autoDispatch
  const col = columns.find((c) => c.name === columnName);
  if (col?.autoDispatch && project.defaultAgentConfigId) {
    await ctx.db.insert("workspaces", {
      issueId,
      projectId: rule.projectId,
      worktrees: [],
      status: "creating",
      agentConfigId: project.defaultAgentConfigId,
      agentCwd: "",
      createdAt: now,
    });
  }
}

// --- On-Completion Trigger ---

export async function handleIssueCompletion(
  ctx: MutationCtx,
  issueId: Id<"issues">,
  newStatus: string,
) {
  if (!TERMINAL_COLUMN_NAMES.includes(newStatus)) return;

  // Find on_completion rules where this issue is the current one
  const rules = await ctx.db
    .query("recurrenceRules")
    .withIndex("by_currentIssueId", (q) => q.eq("currentIssueId", issueId))
    .collect();

  for (const rule of rules) {
    if (rule.status === "active" && rule.triggerMode === "on_completion") {
      await spawnRecurringIssue(ctx, rule);
    }
  }
}

// --- Fixed-Schedule Processing (called by cron) ---

export const processFixedScheduleRules = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Query all active rules with nextDueAt <= now (capped at 50 to stay
    // within Convex mutation limits; any remaining fire on the next tick)
    const dueRules = await ctx.db
      .query("recurrenceRules")
      .withIndex("by_status_nextDue", (q) =>
        q.eq("status", "active").lte("nextDueAt", now)
      )
      .take(50);

    for (const rule of dueRules) {
      if (rule.triggerMode !== "fixed" || !rule.cronExpression) continue;
      if (!rule.nextDueAt) continue;

      // Idempotency guard
      if (rule.lastFiredAt && rule.lastFiredAt >= rule.nextDueAt) continue;

      await spawnRecurringIssue(ctx, rule);

      // Update lastFiredAt and compute next due time
      const nextDueAt = getNextOccurrence(rule.cronExpression, now);
      await ctx.db.patch(rule._id, {
        lastFiredAt: rule.nextDueAt,
        nextDueAt,
        updatedAt: now,
      });
    }
  },
});
