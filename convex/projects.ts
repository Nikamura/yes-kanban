import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#6B7280", position: 0, visible: false, autoDispatch: false, skipReview: false, skipTests: false, skipPlanning: true },
  { name: "To Do", color: "#3B82F6", position: 1, visible: true, autoDispatch: true, skipReview: false, skipTests: false, skipPlanning: true },
  { name: "In Progress", color: "#F59E0B", position: 2, visible: true, autoDispatch: false, skipReview: false, skipTests: false, skipPlanning: false },
  { name: "In Review", color: "#8B5CF6", position: 3, visible: true, autoDispatch: false, skipReview: false, skipTests: false, skipPlanning: true },
  { name: "Done", color: "#10B981", position: 4, visible: true, autoDispatch: false, skipReview: false, skipTests: false, skipPlanning: true },
  { name: "Cancelled", color: "#EF4444", position: 5, visible: false, autoDispatch: false, skipReview: false, skipTests: false, skipPlanning: true },
];

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    simpleIdPrefix: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (existing) {
      throw new Error(`Project with slug "${args.slug}" already exists`);
    }

    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      slug: args.slug,
      simpleIdPrefix: args.simpleIdPrefix,
      simpleIdCounter: 1,
      maxReviewCycles: 3,
      cleanupDelayMs: 3600000,
      createdAt: Date.now(),
    });

    for (const col of DEFAULT_COLUMNS) {
      await ctx.db.insert("columns", {
        projectId,
        ...col,
      });
    }

    return projectId;
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    defaultAgentConfigId: v.optional(v.id("agentConfigs")),
    planningAgentConfigId: v.optional(v.union(v.id("agentConfigs"), v.null())),
    reviewAgentConfigId: v.optional(v.union(v.id("agentConfigs"), v.null())),
    maxReviewCycles: v.optional(v.number()),
    cleanupDelayMs: v.optional(v.number()),
    disableBuiltInMcp: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const project = await ctx.db.get(id);
    if (!project) throw new Error("Project not found");

    // Separate null values (field deletions) from normal updates
    const patch: Record<string, unknown> = {};
    const fieldsToDelete: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (value === null) {
        fieldsToDelete.push(key);
      } else {
        patch[key] = value;
      }
    }

    // Use db.patch for normal updates (safe with concurrent mutations)
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
    }

    // Use db.replace only when fields need to be deleted (e.g. clearing reviewAgentConfigId)
    if (fieldsToDelete.length > 0) {
      const current = (await ctx.db.get(id))!;
      const { _id, _creationTime, ...fields } = current;
      for (const key of fieldsToDelete) {
        delete (fields as Record<string, unknown>)[key];
      }
      await ctx.db.replace(id, fields);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    // Delete workspaces and their nested run attempts / agent logs
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const ws of workspaces) {
      const runAttempts = await ctx.db
        .query("runAttempts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
        .collect();
      for (const ra of runAttempts) {
        const logs = await ctx.db
          .query("agentLogs")
          .withIndex("by_run_attempt", (q) => q.eq("runAttemptId", ra._id))
          .collect();
        for (const log of logs) {
          await ctx.db.delete(log._id);
        }
        await ctx.db.delete(ra._id);
      }
      await ctx.db.delete(ws._id);
    }

    // Delete issues and their nested comments / attachments
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const issue of issues) {
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const c of comments) {
        await ctx.db.delete(c._id);
      }
      const attachments = await ctx.db
        .query("attachments")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const att of attachments) {
        await ctx.storage.delete(att.storageId);
        await ctx.db.delete(att._id);
      }
      await ctx.db.delete(issue._id);
    }

    // Delete columns
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const col of columns) {
      await ctx.db.delete(col._id);
    }

    // Delete repos
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const repo of repos) {
      await ctx.db.delete(repo._id);
    }

    // Delete agent configs
    const agentConfigs = await ctx.db
      .query("agentConfigs")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const ac of agentConfigs) {
      await ctx.db.delete(ac._id);
    }

    // Delete webhooks
    const webhooks = await ctx.db
      .query("webhooks")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const wh of webhooks) {
      await ctx.db.delete(wh._id);
    }

    await ctx.db.delete(args.id);
  },
});
