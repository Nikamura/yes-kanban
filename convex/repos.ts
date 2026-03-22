import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("repos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("repos") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.string(),
    path: v.string(),
    defaultBranch: v.optional(v.string()),
    setupScript: v.optional(v.string()),
    beforeRunScript: v.optional(v.string()),
    afterRunScript: v.optional(v.string()),
    cleanupScript: v.optional(v.string()),
    scriptTimeoutMs: v.optional(v.number()),
    testCommand: v.optional(v.string()),
    testTimeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("repos", {
      projectId: args.projectId,
      name: args.name,
      slug: args.slug,
      path: args.path,
      defaultBranch: args.defaultBranch ?? "main",
      setupScript: args.setupScript,
      beforeRunScript: args.beforeRunScript,
      afterRunScript: args.afterRunScript,
      cleanupScript: args.cleanupScript,
      scriptTimeoutMs: args.scriptTimeoutMs ?? 120000,
      testCommand: args.testCommand,
      testTimeoutMs: args.testTimeoutMs ?? 300000,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("repos"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    path: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
    setupScript: v.optional(v.string()),
    beforeRunScript: v.optional(v.string()),
    afterRunScript: v.optional(v.string()),
    cleanupScript: v.optional(v.string()),
    scriptTimeoutMs: v.optional(v.number()),
    testCommand: v.optional(v.string()),
    testTimeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const provided = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );
    // Treat empty strings as clearing the field for optional script/test fields
    const clearableFields = ["setupScript", "beforeRunScript", "afterRunScript", "cleanupScript", "testCommand"];
    for (const k of clearableFields) {
      if (provided[k] === "") {
        provided[k] = undefined;
      }
    }
    if (Object.keys(provided).length > 0) {
      await ctx.db.patch(id, provided);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("repos") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
