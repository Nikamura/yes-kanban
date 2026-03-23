import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type TemplateType = "workflow" | "review" | "rebase" | "planning" | "plan_review" | "grilling";
const templateType = v.union(
  v.literal("workflow"),
  v.literal("review"),
  v.literal("rebase"),
  v.literal("planning"),
  v.literal("plan_review"),
  v.literal("grilling"),
);

/**
 * Pure resolution logic: pick the best template given project-level and global candidates.
 * Priority: project-level default > global default > null.
 * Exported for unit testing.
 */
export function resolveTemplate(
  projectTemplates: Doc<"promptTemplates">[],
  globalTemplates: Doc<"promptTemplates">[],
): Doc<"promptTemplates"> | null {
  const projectDefault = projectTemplates.find((t) => t.isDefault);
  if (projectDefault) return projectDefault;
  const globalDefault = globalTemplates.find((t) => t.isDefault);
  if (globalDefault) return globalDefault;
  return null;
}

export const list = query({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    if (args.projectId) {
      // Return project-specific + global templates
      const projectTemplates = await ctx.db
        .query("promptTemplates")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
      const globalTemplates = await ctx.db
        .query("promptTemplates")
        .withIndex("by_project", (q) => q.eq("projectId", undefined))
        .collect();
      return [...projectTemplates, ...globalTemplates];
    }
    // Return only global templates
    return await ctx.db
      .query("promptTemplates")
      .withIndex("by_project", (q) => q.eq("projectId", undefined))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("promptTemplates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Resolve the effective template for a given type and project.
 * Priority: project-level default > global default > null (use hardcoded).
 */
export const resolve = query({
  args: {
    projectId: v.id("projects"),
    type: templateType,
  },
  handler: async (ctx, args) => {
    const projectTemplates = await ctx.db
      .query("promptTemplates")
      .withIndex("by_project_type", (q) =>
        q.eq("projectId", args.projectId).eq("type", args.type)
      )
      .collect();
    const globalTemplates = await ctx.db
      .query("promptTemplates")
      .withIndex("by_project_type", (q) =>
        q.eq("projectId", undefined).eq("type", args.type)
      )
      .collect();
    return resolveTemplate(projectTemplates, globalTemplates);
  },
});

/** Clear isDefault on all templates matching the given scope+type, optionally excluding one. */

async function clearOtherDefaults(
  ctx: MutationCtx,
  projectId: Id<"projects"> | undefined,
  type: TemplateType,
  excludeId?: Id<"promptTemplates">,
) {
  const existing = await ctx.db
    .query("promptTemplates")
    .withIndex("by_project_type", (q) =>
      q.eq("projectId", projectId).eq("type", type)
    )
    .collect();
  for (const t of existing) {
    if (t.isDefault && t._id !== excludeId) {
      await ctx.db.patch(t._id, { isDefault: false });
    }
  }
}

/** Defense-in-depth: verify at most one default exists for the scope+type. */
async function assertSingleDefault(
  ctx: MutationCtx,
  projectId: Id<"projects"> | undefined,
  type: TemplateType,
) {
  const defaults = await ctx.db
    .query("promptTemplates")
    .withIndex("by_project_type", (q) =>
      q.eq("projectId", projectId).eq("type", type)
    )
    .filter((q) => q.eq(q.field("isDefault"), true))
    .collect();
  if (defaults.length > 1) {
    throw new Error(
      `Invariant violation: found ${defaults.length} default templates for type "${type}" in scope ${projectId ?? "global"}`
    );
  }
}

export const create = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    name: v.string(),
    type: templateType,
    content: v.string(),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const isDefault = args.isDefault ?? false;

    // If setting as default, clear existing defaults for this scope+type.
    // Safe from races: Convex mutations run with serializable isolation (OCC),
    // so concurrent mutations touching overlapping rows will retry.
    if (isDefault) {
      await clearOtherDefaults(ctx, args.projectId, args.type);
    }

    const id = await ctx.db.insert("promptTemplates", {
      projectId: args.projectId,
      name: args.name,
      type: args.type,
      content: args.content,
      isDefault,
      createdAt: now,
      updatedAt: now,
    });

    if (isDefault) {
      await assertSingleDefault(ctx, args.projectId, args.type);
    }

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("promptTemplates"),
    name: v.optional(v.string()),
    content: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Template not found");

    // If setting as default, clear other defaults for this scope+type.
    // Safe from races: Convex mutations run with serializable isolation (OCC),
    // so concurrent mutations touching overlapping rows will retry.
    if (args.isDefault === true && !existing.isDefault) {
      await clearOtherDefaults(ctx, existing.projectId, existing.type, args.id);
    }

    await ctx.db.patch(args.id, {
      updatedAt: Date.now(),
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.content !== undefined ? { content: args.content } : {}),
      ...(args.isDefault !== undefined ? { isDefault: args.isDefault } : {}),
    });

    if (args.isDefault === true) {
      await assertSingleDefault(ctx, existing.projectId, existing.type);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("promptTemplates") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
