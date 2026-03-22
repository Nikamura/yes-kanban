import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { recordHistory } from "./issueHistory";
import { validateChecklistItemText, MAX_CHECKLIST_ITEMS } from "./lib/issueValidation";

export const addItem = mutation({
  args: {
    issueId: v.id("issues"),
    text: v.string(),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const text = validateChecklistItemText(args.text);
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const checklist = issue.checklist ?? [];
    if (checklist.length >= MAX_CHECKLIST_ITEMS) {
      throw new Error(`Checklist cannot have more than ${MAX_CHECKLIST_ITEMS} items`);
    }

    const item = { id: crypto.randomUUID(), text, completed: false };
    await ctx.db.patch(args.issueId, {
      checklist: [...checklist, item],
      updatedAt: Date.now(),
    });

    await recordHistory(ctx, {
      issueId: args.issueId,
      projectId: issue.projectId,
      action: "updated",
      field: "checklist",
      newValue: JSON.stringify({ action: "add", text }),
      actor: args.actor ?? "user",
    });

    return item.id;
  },
});

export const removeItem = mutation({
  args: {
    issueId: v.id("issues"),
    itemId: v.string(),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const checklist = issue.checklist ?? [];
    const item = checklist.find((i) => i.id === args.itemId);
    if (!item) throw new Error("Checklist item not found");

    await ctx.db.patch(args.issueId, {
      checklist: checklist.filter((i) => i.id !== args.itemId),
      updatedAt: Date.now(),
    });

    await recordHistory(ctx, {
      issueId: args.issueId,
      projectId: issue.projectId,
      action: "updated",
      field: "checklist",
      newValue: JSON.stringify({ action: "remove", text: item.text }),
      actor: args.actor ?? "user",
    });
  },
});

export const toggleItem = mutation({
  args: {
    issueId: v.id("issues"),
    itemId: v.string(),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const checklist = issue.checklist ?? [];
    const item = checklist.find((i) => i.id === args.itemId);
    if (!item) throw new Error("Checklist item not found");

    const newCompleted = !item.completed;
    await ctx.db.patch(args.issueId, {
      checklist: checklist.map((i) =>
        i.id === args.itemId ? { ...i, completed: newCompleted } : i
      ),
      updatedAt: Date.now(),
    });

    await recordHistory(ctx, {
      issueId: args.issueId,
      projectId: issue.projectId,
      action: "updated",
      field: "checklist",
      newValue: JSON.stringify({
        action: newCompleted ? "check" : "uncheck",
        text: item.text,
      }),
      actor: args.actor ?? "user",
    });
  },
});

export const updateItemText = mutation({
  args: {
    issueId: v.id("issues"),
    itemId: v.string(),
    text: v.string(),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const text = validateChecklistItemText(args.text);
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const checklist = issue.checklist ?? [];
    const item = checklist.find((i) => i.id === args.itemId);
    if (!item) throw new Error("Checklist item not found");

    await ctx.db.patch(args.issueId, {
      checklist: checklist.map((i) =>
        i.id === args.itemId ? { ...i, text } : i
      ),
      updatedAt: Date.now(),
    });

    await recordHistory(ctx, {
      issueId: args.issueId,
      projectId: issue.projectId,
      action: "updated",
      field: "checklist",
      oldValue: JSON.stringify({ text: item.text }),
      newValue: JSON.stringify({ action: "edit", text }),
      actor: args.actor ?? "user",
    });
  },
});

export const reorder = mutation({
  args: {
    issueId: v.id("issues"),
    itemIds: v.array(v.string()),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const checklist = issue.checklist ?? [];
    const uniqueIds = new Set(args.itemIds);
    if (uniqueIds.size !== checklist.length) {
      throw new Error("Item IDs do not match existing checklist items");
    }
    const byId = new Map(checklist.map((i) => [i.id, i]));
    const reordered = args.itemIds
      .map((id) => byId.get(id))
      .filter((i): i is NonNullable<typeof i> => i !== undefined);

    if (reordered.length !== checklist.length) {
      throw new Error("Item IDs do not match existing checklist items");
    }

    await ctx.db.patch(args.issueId, {
      checklist: reordered,
      updatedAt: Date.now(),
    });

    await recordHistory(ctx, {
      issueId: args.issueId,
      projectId: issue.projectId,
      action: "updated",
      field: "checklist",
      newValue: JSON.stringify({ action: "reorder" }),
      actor: args.actor ?? "user",
    });
  },
});
