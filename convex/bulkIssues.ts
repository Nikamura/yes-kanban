import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { recordHistory } from "./issueHistory";
import { unarchiveIssue } from "./lib/archiveHelpers";
import { AUTO_DISPATCH_COLUMNS } from "./lib/boardConstants";
import { WORKSPACE_TERMINAL_STATUSES } from "./workspaces";

export const bulkMove = mutation({
  args: {
    ids: v.array(v.id("issues")),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.ids.length === 0) return;

    // Get max position in target column from the first issue's project
    const firstId = args.ids[0];
    if (!firstId) return;
    const firstIssue = await ctx.db.get(firstId);
    if (!firstIssue) throw new Error("Issue not found");

    const existingInColumn = await ctx.db
      .query("issues")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", firstIssue.projectId).eq("status", args.status)
      )
      .collect();
    let maxPos = existingInColumn.reduce((max, i) => Math.max(max, i.position), -1);

    const project = await ctx.db.get(firstIssue.projectId);

    const now = Date.now();
    for (const id of args.ids) {
      const issue = await ctx.db.get(id);
      if (!issue) continue;

      if (issue.status !== args.status) {
        await recordHistory(ctx, {
          issueId: id,
          projectId: issue.projectId,
          action: "moved",
          field: "status",
          oldValue: JSON.stringify(issue.status),
          newValue: JSON.stringify(args.status),
          actor: "user",
        });
      }

      maxPos += 1;
      await ctx.db.patch(id, {
        status: args.status,
        position: maxPos,
        updatedAt: now,
      });

      if (
        (AUTO_DISPATCH_COLUMNS as readonly string[]).includes(args.status) &&
        project?.defaultAgentConfigId
      ) {
        const existingWorkspaces = await ctx.db
          .query("workspaces")
          .withIndex("by_issue", (q) => q.eq("issueId", id))
          .collect();
        const hasRunning = existingWorkspaces.some(
          (w) => !(WORKSPACE_TERMINAL_STATUSES as readonly string[]).includes(w.status)
        );
        if (!hasRunning) {
          await ctx.db.insert("workspaces", {
            issueId: id,
            projectId: issue.projectId,
            worktrees: [],
            status: "creating",
            agentConfigId: project.defaultAgentConfigId,
            agentCwd: "",
            createdAt: now,
          });
        }
      }
    }
  },
});

export const bulkAddTags = mutation({
  args: {
    ids: v.array(v.id("issues")),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      const issue = await ctx.db.get(id);
      if (!issue) continue;
      const merged = [...new Set([...issue.tags, ...args.tags])];
      if (JSON.stringify(issue.tags) !== JSON.stringify(merged)) {
        await recordHistory(ctx, {
          issueId: id,
          projectId: issue.projectId,
          action: "updated",
          field: "tags",
          oldValue: JSON.stringify(issue.tags),
          newValue: JSON.stringify(merged),
          actor: "user",
        });
      }
      await ctx.db.patch(id, { tags: merged, updatedAt: now });
    }
  },
});

export const bulkRemoveTags = mutation({
  args: {
    ids: v.array(v.id("issues")),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const tagsToRemove = new Set(args.tags);
    const now = Date.now();
    for (const id of args.ids) {
      const issue = await ctx.db.get(id);
      if (!issue) continue;
      const filtered = issue.tags.filter((t) => !tagsToRemove.has(t));
      if (JSON.stringify(issue.tags) !== JSON.stringify(filtered)) {
        await recordHistory(ctx, {
          issueId: id,
          projectId: issue.projectId,
          action: "updated",
          field: "tags",
          oldValue: JSON.stringify(issue.tags),
          newValue: JSON.stringify(filtered),
          actor: "user",
        });
      }
      await ctx.db.patch(id, { tags: filtered, updatedAt: now });
    }
  },
});

export const bulkArchive = mutation({
  args: {
    ids: v.array(v.id("issues")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      const issue = await ctx.db.get(id);
      if (!issue || issue.archivedAt !== undefined) continue;
      await ctx.db.patch(id, { archivedAt: now, updatedAt: now });
      await recordHistory(ctx, {
        issueId: id,
        projectId: issue.projectId,
        action: "archived",
        field: "archivedAt",
        newValue: JSON.stringify(now),
        actor: "user",
      });
    }
  },
});

export const bulkUnarchive = mutation({
  args: {
    ids: v.array(v.id("issues")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const issue = await ctx.db.get(id);
      if (issue?.archivedAt === undefined) continue;
      await unarchiveIssue(ctx, issue);
    }
  },
});

export const bulkDelete = mutation({
  args: {
    ids: v.array(v.id("issues")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const issue = await ctx.db.get(id);
      if (!issue) continue;

      // Delete attachments
      const attachments = await ctx.db
        .query("attachments")
        .withIndex("by_issue", (q) => q.eq("issueId", id))
        .collect();
      for (const att of attachments) {
        await ctx.db.delete(att._id);
      }

      // Delete comments
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", id))
        .collect();
      for (const c of comments) {
        await ctx.db.delete(c._id);
      }

      // Delete history (batched)
      let historyBatch;
      do {
        historyBatch = await ctx.db
          .query("issueHistory")
          .withIndex("by_issue", (q) => q.eq("issueId", id))
          .take(500);
        for (const h of historyBatch) {
          await ctx.db.delete(h._id);
        }
      } while (historyBatch.length === 500);

      await ctx.db.delete(id);
    }
  },
});
