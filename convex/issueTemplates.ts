import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("issueTemplates")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    descriptionTemplate: v.string(),
    defaultPriority: v.optional(v.string()),
    defaultTags: v.array(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("issueTemplates", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("issueTemplates"),
    name: v.optional(v.string()),
    descriptionTemplate: v.optional(v.string()),
    defaultPriority: v.optional(v.string()),
    defaultTags: v.optional(v.array(v.string())),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Template not found");

    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      await ctx.db.patch(id, { ...filtered, updatedAt: Date.now() });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("issueTemplates") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
