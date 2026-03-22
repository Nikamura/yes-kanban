import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordHistory } from "./issueHistory";
import { validateIssueTitle, validateIssueDescription } from "./lib/issueValidation";
import { unarchiveIssue } from "./lib/archiveHelpers";
import { WORKSPACE_TERMINAL_STATUSES } from "./workspaces";
export const list = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    search: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let issues;
    const { status } = args;
    if (args.archived && !status) {
      // Use by_project_archived index for efficient archive queries
      issues = await ctx.db
        .query("issues")
        .withIndex("by_project_archived", (q) =>
          q.eq("projectId", args.projectId).gt("archivedAt", 0)
        )
        .collect();
    } else if (status) {
      issues = await ctx.db
        .query("issues")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", args.projectId).eq("status", status)
        )
        .collect();
      // Filter by archive status in-memory for status-scoped queries
      if (args.archived) {
        issues = issues.filter((i) => i.archivedAt !== undefined);
      } else {
        issues = issues.filter((i) => i.archivedAt === undefined);
      }
    } else {
      issues = await ctx.db
        .query("issues")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
      // Filter out archived issues by default
      issues = issues.filter((i) => i.archivedAt === undefined);
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
    tags: v.optional(v.array(v.string())),
    deepResearch: v.optional(v.boolean()),
    autoMerge: v.optional(v.boolean()),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const title = validateIssueTitle(args.title);
    validateIssueDescription(args.description);

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
      tags: args.tags ?? [],
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
    tags: v.optional(v.array(v.string())),
    blockedBy: v.optional(v.array(v.id("issues"))),
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

    const tracked = ["title", "description", "tags", "blockedBy", "deepResearch", "autoMerge"] as const;
    for (const field of tracked) {
      if (updates[field] !== undefined) {
        const oldVal = issue[field];
        const newVal = updates[field];
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

    const provided = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );
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
    await unarchiveIssue(ctx, issue);
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
