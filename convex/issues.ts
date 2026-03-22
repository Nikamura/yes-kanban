import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordHistory } from "./issueHistory";
import { validateIssueTitle, validateIssueDescription, validateCardColor } from "./lib/issueValidation";
import { WORKSPACE_TERMINAL_STATUSES } from "./workspaces";
import { handleIssueCompletion } from "./recurrenceRules";

export const list = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    search: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let issues;
    const { status } = args;
    if (status) {
      issues = await ctx.db
        .query("issues")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", args.projectId).eq("status", status)
        )
        .collect();
    } else {
      issues = await ctx.db
        .query("issues")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
    }

    // Filter by archive status
    if (args.archived) {
      issues = issues.filter((i) => i.archivedAt !== undefined);
    } else {
      issues = issues.filter((i) => i.archivedAt === undefined);
    }

    if (args.priority) {
      issues = issues.filter((i) => i.priority === args.priority);
    }
    const { tags } = args;
    if (tags && tags.length > 0) {
      issues = issues.filter((i) =>
        tags.some((t) => i.tags.includes(t))
      );
    }
    if (args.search) {
      const s = args.search.toLowerCase();
      issues = issues.filter(
        (i) =>
          i.title.toLowerCase().includes(s) ||
          i.description.toLowerCase().includes(s) ||
          i.simpleId.toLowerCase().includes(s)
      );
    }

    return issues;
  },
});

export const get = query({
  args: { id: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.id);
    if (!issue) return null;

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_issue", (q) => q.eq("issueId", args.id))
      .collect();

    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_issue", (q) => q.eq("issueId", args.id))
      .collect();

    return {
      ...issue,
      workspaceCount: workspaces.length,
      attachmentCount: attachments.length,
    };
  },
});

export const getBySimpleId = query({
  args: { projectId: v.id("projects"), simpleId: v.string() },
  handler: async (ctx, args) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return issues.find((i) => i.simpleId === args.simpleId) ?? null;
  },
});

export const getByIds = query({
  args: { ids: v.array(v.id("issues")) },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.ids.map((id) => ctx.db.get(id))
    );
    return results.filter((r) => r !== null);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.string(),
    status: v.string(),
    priority: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    dueDate: v.optional(v.number()),
    color: v.optional(v.string()),
    deepResearch: v.optional(v.boolean()),
    autoMerge: v.optional(v.boolean()),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const title = validateIssueTitle(args.title);
    validateIssueDescription(args.description);
    if (args.color) validateCardColor(args.color);

    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const simpleId = `${project.simpleIdPrefix}-${project.simpleIdCounter}`;
    await ctx.db.patch(args.projectId, {
      simpleIdCounter: project.simpleIdCounter + 1,
    });

    // Get max position in target column
    const existingInColumn = await ctx.db
      .query("issues")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", args.status)
      )
      .collect();
    const maxPos = existingInColumn.reduce((max, i) => Math.max(max, i.position), -1);

    const now = Date.now();
    const issueId = await ctx.db.insert("issues", {
      projectId: args.projectId,
      simpleId,
      title,
      description: args.description,
      status: args.status,
      priority: args.priority,
      tags: args.tags ?? [],
      dueDate: args.dueDate,
      color: args.color,
      deepResearch: args.deepResearch,
      ...(args.autoMerge !== undefined && { autoMerge: args.autoMerge }),
      position: maxPos + 1,
      createdAt: now,
      updatedAt: now,
    });

    await recordHistory(ctx, {
      issueId,
      projectId: args.projectId,
      action: "created",
      field: "issue",
      actor: args.actor ?? "user",
    });

    // Check if target column has autoDispatch
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const targetColumn = columns.find((c) => c.name === args.status);
    if (targetColumn?.autoDispatch && project.defaultAgentConfigId) {
      await ctx.db.insert("workspaces", {
        issueId,
        projectId: args.projectId,
        worktrees: [],
        status: "creating",
        agentConfigId: project.defaultAgentConfigId,
        agentCwd: "",
        createdAt: now,
      });
    }

    return issueId;
  },
});

export const update = mutation({
  args: {
    id: v.id("issues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    blockedBy: v.optional(v.array(v.id("issues"))),
    dueDate: v.optional(v.number()),
    color: v.optional(v.string()),
    deepResearch: v.optional(v.boolean()),
    autoMerge: v.optional(v.boolean()),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const { id, actor: actorArg, ...updates } = args;
    if (updates.title !== undefined) {
      updates.title = validateIssueTitle(updates.title);
    }
    if (updates.description !== undefined) {
      validateIssueDescription(updates.description);
    }

    const actor = actorArg ?? "user";
    const issue = await ctx.db.get(id);
    if (!issue) throw new Error("Issue not found");

    // Normalize dueDate: 0 means "clear the due date"
    const dueDateVal = updates.dueDate;
    const normalizedDueDate = dueDateVal === 0 ? undefined : dueDateVal;

    // Normalize color: empty string means "clear the color"
    const colorVal = updates.color;
    const normalizedColor = colorVal === "" ? undefined : colorVal;
    if (normalizedColor) validateCardColor(normalizedColor);

    const normalizedFields: Record<string, unknown> = { dueDate: normalizedDueDate, color: normalizedColor };
    const tracked = ["title", "description", "priority", "tags", "blockedBy", "dueDate", "color", "deepResearch", "autoMerge"] as const;
    for (const field of tracked) {
      if (updates[field] !== undefined) {
        const oldVal = issue[field];
        const newVal = field in normalizedFields ? normalizedFields[field] : updates[field];
        const serialize = (v: unknown) =>
          Array.isArray(v) ? JSON.stringify([...v].sort()) : JSON.stringify(v);
        if (serialize(oldVal) !== serialize(newVal)) {
          await recordHistory(ctx, {
            issueId: id,
            projectId: issue.projectId,
            action: "updated",
            field,
            // eslint-disable-next-line eqeqeq
            oldValue: oldVal != null ? JSON.stringify(oldVal) : undefined,
            // eslint-disable-next-line eqeqeq
            newValue: newVal != null ? JSON.stringify(newVal) : undefined,
            actor,
          });
        }
      }
    }

    // Strip unprovided fields, then normalize sentinels to undefined so db.patch clears them
    // (same pattern as columns.ts — Convex db.patch removes optional fields set to undefined)
    const provided = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );
    if (normalizedDueDate !== updates["dueDate"]) provided["dueDate"] = normalizedDueDate;
    if (normalizedColor !== updates["color"]) provided["color"] = normalizedColor;
    if (Object.keys(provided).length > 0) {
      await ctx.db.patch(id, { ...provided, updatedAt: Date.now() });
    }
  },
});

export const move = mutation({
  args: {
    id: v.id("issues"),
    status: v.string(),
    position: v.number(),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.id);
    if (!issue) throw new Error("Issue not found");

    if (issue.status !== args.status) {
      await recordHistory(ctx, {
        issueId: args.id,
        projectId: issue.projectId,
        action: "moved",
        field: "status",
        oldValue: JSON.stringify(issue.status),
        newValue: JSON.stringify(args.status),
        actor: args.actor ?? "user",
      });
    }

    await ctx.db.patch(args.id, {
      status: args.status,
      position: args.position,
      updatedAt: Date.now(),
    });

    // Check auto-dispatch
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", issue.projectId))
      .collect();
    const targetColumn = columns.find((c) => c.name === args.status);

    if (targetColumn?.autoDispatch) {
      const project = await ctx.db.get(issue.projectId);
      if (project?.defaultAgentConfigId) {
        const existingWorkspaces = await ctx.db
          .query("workspaces")
          .withIndex("by_issue", (q) => q.eq("issueId", args.id))
          .collect();
        const hasRunning = existingWorkspaces.some(
          (w) => !(WORKSPACE_TERMINAL_STATUSES as readonly string[]).includes(w.status)
        );
        if (!hasRunning) {
          await ctx.db.insert("workspaces", {
            issueId: args.id,
            projectId: issue.projectId,
            worktrees: [],
            status: "creating",
            agentConfigId: project.defaultAgentConfigId,
            agentCwd: "",
            createdAt: Date.now(),
          });
        }
      }
    }

    // Check on-completion recurrence rules
    if (issue.status !== args.status) {
      await handleIssueCompletion(ctx, args.id, args.status);
    }
  },
});

export const archive = mutation({
  args: { id: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.id);
    if (!issue) throw new Error("Issue not found");
    if (issue.archivedAt !== undefined) return;

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });
    await recordHistory(ctx, {
      issueId: args.id,
      projectId: issue.projectId,
      action: "archived",
      field: "archivedAt",
      newValue: JSON.stringify(now),
      actor: "user",
    });
  },
});

export const unarchive = mutation({
  args: { id: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.id);
    if (!issue) throw new Error("Issue not found");
    if (issue.archivedAt === undefined) return;

    // Check if original column still exists; if not, use first visible column
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", issue.projectId))
      .collect();
    const columnExists = columns.some((c) => c.name === issue.status);
    const targetStatus = columnExists
      ? issue.status
      : (columns.filter((c) => c.visible).sort((a, b) => a.position - b.position)[0]?.name ?? issue.status);

    // Get max position in target column
    const existingInColumn = await ctx.db
      .query("issues")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", issue.projectId).eq("status", targetStatus)
      )
      .collect();
    const maxPos = existingInColumn.reduce((max, i) => Math.max(max, i.position), -1);

    const now = Date.now();
    await ctx.db.patch(args.id, {
      archivedAt: undefined,
      status: targetStatus,
      position: maxPos + 1,
      updatedAt: now,
    });
    await recordHistory(ctx, {
      issueId: args.id,
      projectId: issue.projectId,
      action: "unarchived",
      field: "archivedAt",
      oldValue: JSON.stringify(issue.archivedAt),
      actor: "user",
    });
  },
});

export const remove = mutation({
  args: { id: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.id);
    if (!issue) throw new Error("Issue not found");

    // Delete attachments
    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_issue", (q) => q.eq("issueId", args.id))
      .collect();
    for (const att of attachments) {
      await ctx.db.delete(att._id);
    }

    // Delete comments
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issue", (q) => q.eq("issueId", args.id))
      .collect();
    for (const c of comments) {
      await ctx.db.delete(c._id);
    }

    // Delete history (batched)
    let historyBatch;
    do {
      historyBatch = await ctx.db
        .query("issueHistory")
        .withIndex("by_issue", (q) => q.eq("issueId", args.id))
        .take(500);
      for (const h of historyBatch) {
        await ctx.db.delete(h._id);
      }
    } while (historyBatch.length === 500);

    await ctx.db.delete(args.id);
  },
});
