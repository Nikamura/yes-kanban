import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api } from "./_generated/api";
import { resolveSourceUrl, fetchAndParseSkill } from "./lib/skillHelpers";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("skills")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listEnabled = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("skills")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return all.filter((s) => s.enabled);
  },
});

export const get = query({
  args: { id: v.id("skills") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.string(),
    content: v.string(),
    enabled: v.optional(v.boolean()),
    source: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("skills", {
      projectId: args.projectId,
      name: args.name,
      description: args.description,
      content: args.content,
      enabled: args.enabled ?? true,
      source: args.source,
      sourceUrl: args.sourceUrl,
      sourceRef: args.sourceRef,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("skills"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    content: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    source: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates as Record<string, unknown>).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      await ctx.db.patch(id, { ...filtered, updatedAt: Date.now() });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("skills") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const installFromSource = action({
  args: {
    projectId: v.id("projects"),
    sourceRef: v.string(),
  },
  handler: async (ctx, args): Promise<{ name: string; description: string; source: string }> => {
    const { url, source } = resolveSourceUrl(args.sourceRef.trim());
    const parsed = await fetchAndParseSkill(url);

    // Upsert: check if skill with same sourceRef already exists
    const existing = await ctx.runQuery(api.skills.list, { projectId: args.projectId });
    const match = existing.find((s) => s.sourceRef === args.sourceRef.trim());

    if (match) {
      await ctx.runMutation(api.skills.update, {
        id: match._id,
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        source,
        sourceUrl: url,
        sourceRef: args.sourceRef.trim(),
      });
    } else {
      await ctx.runMutation(api.skills.create, {
        projectId: args.projectId,
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        enabled: true,
        source,
        sourceUrl: url,
        sourceRef: args.sourceRef.trim(),
      });
    }

    return { name: parsed.name, description: parsed.description, source };
  },
});

export const updateFromSource = action({
  args: {
    id: v.id("skills"),
  },
  handler: async (ctx, args): Promise<{ name: string; description: string }> => {
    const skill = await ctx.runQuery(api.skills.get, { id: args.id });
    if (!skill) {
      throw new Error("Skill not found");
    }
    if (!skill.sourceRef && !skill.sourceUrl) {
      throw new Error("Skill has no remote source to update from");
    }

    // Re-resolve from sourceRef when available so URL logic stays current
    const { url, source } = skill.sourceRef
      ? resolveSourceUrl(skill.sourceRef)
      : { url: skill.sourceUrl!, source: skill.source ?? "url" };

    const parsed = await fetchAndParseSkill(url);

    await ctx.runMutation(api.skills.update, {
      id: args.id,
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      sourceUrl: url,
      source,
    });

    return { name: parsed.name, description: parsed.description };
  },
});
