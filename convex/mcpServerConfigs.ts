import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mcpServerConfigs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listEnabled = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("mcpServerConfigs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return all.filter((c) => c.enabled);
  },
});

export const get = query({
  args: { id: v.id("mcpServerConfigs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    command: v.string(),
    args: v.optional(v.array(v.string())),
    env: v.optional(v.record(v.string(), v.string())),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("mcpServerConfigs", {
      projectId: args.projectId,
      name: args.name,
      command: args.command,
      args: args.args ?? [],
      env: args.env,
      enabled: args.enabled ?? true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("mcpServerConfigs"),
    name: v.optional(v.string()),
    command: v.optional(v.string()),
    args: v.optional(v.array(v.string())),
    env: v.optional(v.record(v.string(), v.string())),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates as Record<string, unknown>).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      await ctx.db.patch(id, filtered);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("mcpServerConfigs") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/**
 * Declarative sync: accept the full mcpServers JSON object and reconcile with DB.
 * Creates new entries, updates existing ones, and deletes removed ones.
 */
export const syncFromJson = mutation({
  args: {
    projectId: v.id("projects"),
    mcpServers: v.record(
      v.string(),
      v.object({
        command: v.string(),
        args: v.optional(v.array(v.string())),
        env: v.optional(v.record(v.string(), v.string())),
        enabled: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpServerConfigs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const existingByName = new Map(existing.map((c) => [c.name, c]));
    const incomingNames = new Set(Object.keys(args.mcpServers));

    // Create or update
    for (const [name, config] of Object.entries(args.mcpServers)) {
      // Skip "yes-kanban" — it's the built-in server
      if (name === "yes-kanban") continue;

      const existingConfig = existingByName.get(name);
      if (existingConfig) {
        await ctx.db.patch(existingConfig._id, {
          command: config.command,
          args: config.args ?? [],
          env: config.env,
          enabled: config.enabled ?? true,
        });
      } else {
        await ctx.db.insert("mcpServerConfigs", {
          projectId: args.projectId,
          name,
          command: config.command,
          args: config.args ?? [],
          env: config.env,
          enabled: config.enabled ?? true,
          createdAt: Date.now(),
        });
      }
    }

    // Delete configs not in incoming JSON
    for (const config of existing) {
      if (!incomingNames.has(config.name)) {
        await ctx.db.delete(config._id);
      }
    }
  },
});
