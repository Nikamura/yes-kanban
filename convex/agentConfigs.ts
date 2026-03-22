import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { validateAgentConfigArgs } from "./lib/agentConfigValidation";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentConfigs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("agentConfigs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    agentType: v.string(),
    command: v.string(),
    args: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    maxRetries: v.optional(v.number()),
    retryBackoffMs: v.optional(v.number()),
    maxRetryBackoffMs: v.optional(v.number()),
    env: v.optional(v.record(v.string(), v.string())),
    mcpEnabled: v.optional(v.boolean()),
    mcpTools: v.optional(v.array(v.string())),
    permissionMode: v.optional(v.union(v.literal("bypass"), v.literal("accept"))),
    allowedToolPatterns: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    validateAgentConfigArgs(args);

    return await ctx.db.insert("agentConfigs", {
      projectId: args.projectId,
      name: args.name,
      agentType: args.agentType,
      command: args.command,
      args: args.args ?? [],
      model: args.model,
      timeoutMs: args.timeoutMs ?? 3600000,
      maxRetries: args.maxRetries ?? 3,
      retryBackoffMs: args.retryBackoffMs ?? 10000,
      maxRetryBackoffMs: args.maxRetryBackoffMs ?? 300000,
      env: args.env,
      mcpEnabled: args.mcpEnabled ?? true,
      mcpTools: args.mcpTools,
      permissionMode: args.permissionMode,
      allowedToolPatterns: args.allowedToolPatterns,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("agentConfigs"),
    name: v.optional(v.string()),
    agentType: v.optional(v.string()),
    command: v.optional(v.string()),
    args: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    maxRetries: v.optional(v.number()),
    retryBackoffMs: v.optional(v.number()),
    maxRetryBackoffMs: v.optional(v.number()),
    env: v.optional(v.record(v.string(), v.string())),
    mcpEnabled: v.optional(v.boolean()),
    mcpTools: v.optional(v.array(v.string())),
    permissionMode: v.optional(v.union(v.literal("bypass"), v.literal("accept"))),
    allowedToolPatterns: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    validateAgentConfigArgs(args);

    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates as Record<string, unknown>).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      await ctx.db.patch(id, filtered);
    }
  },
});

export const addAllowedTool = mutation({
  args: {
    id: v.id("agentConfigs"),
    toolPattern: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.id);
    if (!config) throw new Error("Agent config not found");
    const existing = config.allowedToolPatterns ?? [];
    if (!existing.includes(args.toolPattern)) {
      await ctx.db.patch(args.id, {
        allowedToolPatterns: [...existing, args.toolPattern],
      });
    }
  },
});

export const removeAllowedTool = mutation({
  args: {
    id: v.id("agentConfigs"),
    toolPattern: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.id);
    if (!config) throw new Error("Agent config not found");
    const existing = config.allowedToolPatterns ?? [];
    await ctx.db.patch(args.id, {
      allowedToolPatterns: existing.filter((p) => p !== args.toolPattern),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("agentConfigs") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
