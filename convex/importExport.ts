import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { escapeCsv } from "./lib/csvHelpers";

export const importIssues = action({
  args: {
    projectId: v.id("projects"),
    issues: v.array(
      v.object({
        title: v.string(),
        description: v.string(),
        status: v.string(),
        priority: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        externalId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ imported: number; errors: string[] }> => {
    const errors: string[] = [];
    let imported = 0;

    const columns = await ctx.runQuery(api.columns.list, { projectId: args.projectId });
    const validStatuses = new Set(columns.map((c: { name: string }) => c.name));
    const validPriorities = new Set(["urgent", "high", "medium", "low"]);

    for (const issue of args.issues) {
      if (!validStatuses.has(issue.status)) {
        errors.push(
          `Failed to import "${issue.title}": invalid status "${issue.status}". Valid statuses: ${[...validStatuses].join(", ")}`
        );
        continue;
      }
      if (issue.priority && !validPriorities.has(issue.priority)) {
        errors.push(
          `Failed to import "${issue.title}": invalid priority "${issue.priority}". Valid priorities: urgent, high, medium, low`
        );
        continue;
      }
      try {
        await ctx.runMutation(api.issues.create, {
          projectId: args.projectId,
          title: issue.title,
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
          tags: issue.tags,
        });
        imported++;
      } catch (err) {
        errors.push(
          `Failed to import "${issue.title}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return { imported, errors };
  },
});

export const exportIssues = action({
  args: {
    projectId: v.id("projects"),
    format: v.union(v.literal("json"), v.literal("csv")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const issues = await ctx.runQuery(api.issues.list, {
      projectId: args.projectId,
      status: args.status,
    });

    const exportable = issues.map((issue) => ({
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      tags: issue.tags,
      externalId: issue.simpleId,
    }));

    if (args.format === "json") {
      return JSON.stringify(exportable, null, 2);
    }

    // CSV export
    const header = "Title,Description,Status,Priority,Tags,External ID";
    if (exportable.length === 0) return header;

    const rows = exportable.map((issue) =>
      [
        escapeCsv(issue.title),
        escapeCsv(issue.description),
        escapeCsv(issue.status),
        escapeCsv(issue.priority ?? ""),
        escapeCsv(issue.tags.join(",")),
        escapeCsv(issue.externalId),
      ].join(",")
    );

    return [header, ...rows].join("\n");
  },
});
