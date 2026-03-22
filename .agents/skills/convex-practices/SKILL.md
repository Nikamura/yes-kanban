---
name: convex-practices
description: >
  Convex database, functions, schema design, and best practices for this project.
  Use this skill whenever working in the convex/ directory, editing schema.ts,
  writing or modifying queries/mutations/actions, working with Convex indexes,
  pagination, file storage, scheduling, or real-time subscriptions. Also trigger
  when touching React code that uses useQuery/useMutation from convex/react,
  or when dealing with Convex types (v.*, Id<>, Doc<>). Trigger on any database
  design decisions, data modeling, or Convex deployment questions. If you see
  imports from "convex/server", "convex/values", or "_generated/api", use this skill.
---

# Convex Practices

This project uses **Convex** as its reactive database and backend. We run it self-hosted via Docker (see `docker-compose.yml`).

## Reference

For detailed Convex docs, fetch the latest documentation:

1. Start with `https://docs.convex.dev/llms.txt` to get the documentation index
2. Find the relevant section URL for your topic
3. Fetch that specific page for detailed API docs

If the URL is unavailable, fall back to your training knowledge or web search.

## Core architecture

- **Queries** are reactive -- clients auto-update when underlying data changes
- **Mutations** are transactional with optimistic concurrency control (OCC)
- **Actions** can call external APIs but are not transactional
- Schema is defined in `convex/schema.ts` with validators from `convex/values`
- Generated types live in `convex/_generated/` -- never edit these manually

## Best practices (critical)

### 1. Always await all promises

Every `ctx.db.*`, `ctx.scheduler.*`, and `ctx.runMutation` call must be awaited. Un-awaited promises silently fail. Use the `no-floating-promises` ESLint rule.

### 2. Avoid `.filter()` on database queries

The `.filter()` method on Convex queries scans all documents. Use `.withIndex()` instead for efficient filtering:

```ts
// Bad -- scans entire table
const msgs = await ctx.db.query("issues")
  .filter((q) => q.eq(q.field("status"), "active"))
  .collect();

// Good -- uses index
const msgs = await ctx.db.query("issues")
  .withIndex("by_project_status", (q) =>
    q.eq("projectId", projectId).eq("status", "active")
  )
  .collect();
```

### 3. Guard `.collect()` -- only use with bounded results

If a query might return 1000+ documents, add an index constraint, use `.take(n)`, or paginate. Unbounded `.collect()` causes performance issues and excessive bandwidth.

### 4. Validate arguments on all public functions

```ts
export const updateIssue = mutation({
  args: {
    id: v.id("issues"),
    title: v.string(),
  },
  handler: async (ctx, { id, title }) => {
    await ctx.db.patch(id, { title });
  },
});
```

Never use unvalidated handler args on public functions -- they can be called by anyone.

### 5. Schedule and `ctx.run*` only internal functions

Use `internal.module.fn` (not `api.module.fn`) for `ctx.scheduler.runAfter`, `ctx.runMutation`, `ctx.runAction`. Public functions (`api.*`) should only be called by clients.

### 6. Check for redundant indexes

An index `by_foo_and_bar` on `["foo", "bar"]` can serve queries that only filter on `foo`. You don't need a separate `by_foo` index unless you need different sort order on `_creationTime`.

## Schema patterns in this project

The schema is in `convex/schema.ts`. When adding new tables or indexes:
- Define indexes for any field you'll filter on frequently
- Use compound indexes (`["projectId", "status"]`) when you filter on multiple fields together
- Remember: index order matters -- put equality fields first, range fields last

## Common patterns

### Query with index

```ts
export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});
```

### Mutation with scheduler

```ts
export const dispatch = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await ctx.db.patch(workspaceId, { status: "running" });
    await ctx.scheduler.runAfter(0, internal.worker.execute, { workspaceId });
  },
});
```

### Action calling external service

```ts
export const callApi = internalAction({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const response = await fetch(url);
    const data = await response.json();
    await ctx.runMutation(internal.results.store, { data });
  },
});
```

## Testing Convex functions

This project can test Convex functions using `convex-test` (Vitest-based mock) or against a real local backend via Docker.

```ts
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const t = convexTest(schema, modules);
const result = await t.query(api.issues.list, { projectId });
```
