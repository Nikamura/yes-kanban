# Yes Kanban Specification

Status: Draft
Purpose: Define a self-hosted, single-user kanban system that orchestrates coding agents to execute project work.

## 1. Problem Statement

Yes Kanban is a self-hosted application for a single developer who wants to plan work as kanban issues and dispatch coding agents to execute that work in isolated git worktrees.

The application solves four problems:

- It provides a kanban board for planning and tracking coding tasks with priorities, tags, and blockers.
- It creates isolated git worktree workspaces per task so agents operate on clean branches without interfering with each other or the developer's working copy.
- It supports both manual dispatch (pick an issue, configure the agent, kick it off) and automatic dispatch (issues entering **To Do** get queued for agents).
- It gives the developer a web UI to review code diffs, stream agent logs, and manage the full lifecycle from issue creation through PR.

Important boundary:

- Yes Kanban is a planner, dispatcher, and reviewer. It is not a coding agent itself.
- Coding agents run as CLI subprocesses. Yes Kanban manages their lifecycle and captures their output.
- Git forge operations (PR creation) are performed via CLI tools (e.g. `gh`) that the developer has already authenticated.

## 2. Goals and Non-Goals

### 2.1 Goals

- Provide a kanban board with a fixed four-stage flow (Backlog → To Do → In Progress → Done), drag-and-drop, tags, and blockers.
- Store all data in Convex (self-hosted) with real-time reactive subscriptions.
- Create git worktree workspaces per issue for agent execution (one worktree per project repo).
- Launch coding agents as CLI subprocesses with configurable concurrency.
- Stream agent output in real-time to the web UI via Convex subscriptions.
- Show code diffs from agent work for review before merging.
- Support auto-dispatch when an issue lands in **To Do** and manual dispatch from any issue.
- Run as a monolith by default (Convex + worker), with support for running the worker on a separate machine.
- Integrate with GitHub, GitLab, and Azure DevOps for PR creation via a pluggable forge adapter.
- Require no authentication (single user, self-hosted, localhost by default).
- Support auto-retry with exponential backoff on agent failure.
- Track token usage and API costs across all agent runs.

### 2.2 Non-Goals

- Multi-user or team collaboration features.
- Cloud sync or hosted service (Convex runs locally/self-hosted).
- Built-in browser preview or dev server management.
- Being a coding agent. Agent logic is external.
- Supporting non-git projects.
- Mobile-responsive UI.

## 3. System Overview

### 3.1 Architecture

Yes Kanban has three components:

1. **Convex Backend** — Self-hosted Convex instance (Docker). Provides the reactive database, real-time subscriptions, and server-side functions (queries, mutations, actions). This is the single source of truth for all application state.

2. **Worker** — A Bun/TypeScript process that manages git worktrees, launches agent subprocesses, and streams output into Convex. By default runs on the same machine as Convex. Can optionally run on a separate machine connected to the Convex instance.

3. **Web UI** — React single-page application using the Convex React client. Kanban board, issue detail panel, workspace/diff viewer, agent log stream. All reads are real-time subscriptions — no polling or manual refresh needed. The UI uses **Tailwind CSS v4** and **shadcn/ui** (Base UI primitives under `src/ui/components/ui/`; add new primitives with `bunx shadcn@latest add <name>` only when needed). Theme tokens live in `src/ui/globals.css`; class-based dark/light mode is applied on `<html>` via an inline first-paint script plus `ThemeProvider`. Legacy layout rules may still live in `src/ui/styles.css` while migrating remaining views. E2E tests prefer `data-testid` where present; some flows still target legacy CSS classes until those surfaces migrate.

```
┌─────────────────────────────────────────────────────┐
│                     Web UI (React)                   │
│  useQuery(api.issues.list)  useMutation(api.issues.  │
│  useQuery(api.agent.logs)   create)                  │
└──────────────────────┬──────────────────────────────┘
                       │ Convex React Client
                       │ (real-time subscriptions)
┌──────────────────────▼──────────────────────────────┐
│                 Convex Backend                        │
│                                                       │
│  Tables: projects, issues, columns, workspaces,      │
│          runAttempts, agentLogs, agentConfigs, repos  │
│                                                       │
│  Functions:                                           │
│    queries   → read data (reactive)                  │
│    mutations → write data (transactional)            │
│    actions   → call worker, run git/forge commands   │
└──────────────────────┬──────────────────────────────┘
                       │ Convex actions / internal API
┌──────────────────────▼──────────────────────────────┐
│                    Worker                             │
│                                                       │
│  - Polls Convex for dispatched tasks                 │
│  - Manages git worktrees on local filesystem         │
│  - Launches agent CLI subprocesses                   │
│  - Streams stdout lines into Convex as agentLogs     │
│  - Reports completion/failure back to Convex         │
└─────────────────────────────────────────────────────┘
```

### 3.2 Main Components

1. `Convex Schema & Functions` — Database tables, queries, mutations, and actions for all domain entities.

2. `Dispatcher` — Convex-side logic (mutation + scheduled function) that watches for issues entering auto-dispatch columns and creates workspace + run attempt records.

3. `Worker Process` — Bun process that connects to Convex, claims dispatched work, manages git worktrees, runs agents, and writes results back.

4. `Agent Runner` — Within the worker: launches agent CLI, captures output, detects completion/failure/timeout.

5. `Forge Adapter` — Within the worker: creates pull requests via CLI tools (`gh`).

6. `Web UI` — React app with Convex client. All reads are `useQuery` (reactive), all writes are `useMutation`.

### 3.3 External Dependencies

- Convex self-hosted (Docker).
- Git CLI (for worktree management).
- Coding agent CLI (e.g. `claude` for Claude Code).
- Optional: `gh` CLI for GitHub PR creation.
- Bun runtime (for the worker process).
- Node.js (for Convex dev tooling / functions).

## 4. Core Domain Model

All entities are stored as Convex documents.

### 4.1 Issue

An issue is the unit of work.

Fields:

- `_id` (Id<"issues">) — Convex document ID.
- `projectId` (Id<"projects">) — Parent project.
- `simpleId` (string) — Human-readable sequential ID (e.g. `TASK-42`). Unique within a project.
- `title` (string) — Short description of what needs to be done.
- `description` (string) — Markdown body.
- `status` (string) — Current column/status name.
- `tags` (list of strings) — Freeform labels for categorization and filtering.
- `blockedBy` (list of Id<"issues">) — Issues that block this issue. Used for dispatch eligibility checks.
- `position` (number) — Sort order within its column (for manual ordering).
- `createdAt` (number) — Unix timestamp ms.
- `updatedAt` (number) — Unix timestamp ms.

### 4.2 Project

A project contains a board and a set of issues.

Fields:

- `_id` (Id<"projects">)
- `name` (string)
- `slug` (string) — Used for URLs and worktree branch naming.
- `simpleIdPrefix` (string) — e.g. `TASK`, used for generating simple IDs.
- `simpleIdCounter` (number) — Next sequential number.
- `defaultAgentConfigId` (Id<"agentConfigs"> or null) — Default agent config for auto-dispatch.
- `planningAgentConfigId` (Id<"agentConfigs"> or null) — Agent config for planning runs. If null, uses the default agent config.
- `reviewAgentConfigId` (Id<"agentConfigs"> or null) — Agent config for review runs. If null, uses the coding agent config.
- `maxReviewCycles` (number) — Maximum code → review → fix iterations. Default: `3`.
- `cleanupDelayMs` (number) — Delay before worktree cleanup after merge. Default: `3600000` (1 hour).
- `mergePolicy` (string or null, optional) — One of: `auto_merge`, `manual_merge`, `local_merge`. Cleared in the UI stores `null` or removes the field (both allowed).
- `skipReview` (boolean, optional) — Skip the independent review stage.
- `skipTests` (boolean, optional) — Skip the testing stage.
- `skipPlanning` (boolean, optional) — When `false`, the planning phase runs; when `true` or unset (legacy), planning is skipped by default in the worker.
- `autoPlanReview` (boolean, optional) — Run an automated plan review when planning is enabled.
- `maxConcurrent` (number or null, optional) — Max concurrent agent runs **for this project** (dispatch limit). Distinct from the worker-wide `maxConcurrentAgents` cap. Cleared in the UI stores `null` or removes the field.
- `maxConcurrentPlanning`, `maxConcurrentCoding`, `maxConcurrentTesting`, `maxConcurrentReviewing` (number or null, optional each) — Optional per-phase caps **for this project** (planning / coding / testing / reviewing workspace statuses). Unset or `null` means no per-phase limit for that phase. These apply in addition to `maxConcurrent` and the worker-wide limits.
- `createdAt` (number)

### 4.3 Column

Columns are **fixed** for every project: **Backlog**, **To Do**, **In Progress**, **Done** (in that order). Users cannot add, remove, rename, hide, or reorder columns. Only **color** is editable (cosmetic).

The `columns` table still stores legacy per-column fields for backward compatibility after migration; runtime workflow behavior uses **project** fields in §4.2.

Fields:

- `_id` (Id<"columns">)
- `projectId` (Id<"projects">)
- `name` (string) — One of the four fixed names above.
- `color` (string) — Hex color code (user-editable).
- `position` (number) — Sort order on the board (fixed).
- `visible` (boolean) — Always `true` for all four columns.
- `autoDispatch` (boolean) — Legacy; **To Do** is the only auto-dispatch column in the simplified flow.
- `mergePolicy`, `skipReview`, `skipTests`, etc. — Legacy; use project-level fields instead.

### 4.4 Workspace

A workspace represents one agent execution session for an issue. A workspace creates a git worktree in **each** repository configured for the project, giving the agent access to all repos simultaneously.

Fields:

- `_id` (Id<"workspaces">)
- `issueId` (Id<"issues"> or null) — Associated issue. Null for standalone workspaces.
- `projectId` (Id<"projects">)
- `worktrees` (list of WorktreeEntry objects) — One per project repo.
- `status` (string) — Lifecycle stage. One of: `creating`, `planning`, `awaiting_feedback`, `coding`, `testing`, `test_failed`, `reviewing`, `changes_requested`, `completed`, `creating_pr`, `pr_open`, `merging`, `merged`, `rebasing`, `conflict`, `failed`, `cancelled`. See Section 11 for details.
- `agentConfigId` (Id<"agentConfigs">)
- `agentCwd` (string) — The directory the agent subprocess runs in.
- `plan` (string or null) — Implementation plan text (Markdown).
- `planApproved` (boolean or null) — Whether the plan has been approved by the user.
- `experimentNumber` (number or null) — Current experiment iteration (1-based).
- `createdAt` (number)
- `completedAt` (number or null)

#### 4.4.1 Worktree Entry (embedded object)

- `repoId` (Id<"repos">) — Reference to the project's repository config.
- `repoPath` (string) — Path to the source repository.
- `baseBranch` (string) — Branch the worktree is based on.
- `branchName` (string) — The worktree's own branch name.
- `worktreePath` (string) — Absolute path to the worktree directory.

### 4.5 Agent Configuration

Fields:

- `_id` (Id<"agentConfigs">)
- `projectId` (Id<"projects">)
- `name` (string) — Human-readable name (e.g. "Claude Code - Sonnet").
- `agentType` (string) — Agent adapter identifier. Only `claude-code`, `codex`, `cursor`, and `opencode` are supported; create/update mutations reject other values.
- `command` (string) — CLI command to execute (e.g. `claude`).
- `args` (list of strings) — Default CLI arguments.
- `model` (string or null) — Model identifier to pass to the agent.
- `effort` (`low`, `medium`, or `high`, optional) — Reasoning effort passed to the agent CLI (`--effort` / `-c model_reasoning_effort=` / `--reasoning-effort`). When unset, the CLI default applies.
- `timeoutMs` (number) — Max execution time per run. Default: `3600000` (1 hour).
- `maxRetries` (number) — Maximum automatic retry attempts on failure. Default: `3`. Set to `0` to disable auto-retry.
- `retryBackoffMs` (number) — Base backoff delay in ms. Default: `10000`.
- `maxRetryBackoffMs` (number) — Maximum backoff cap. Default: `300000` (5 minutes).
- `env` (map of string to string) — Additional environment variables for the agent process.
- `mcpEnabled` (boolean) — Whether to start an MCP server for this agent. Default: `true`.
- `mcpTools` (list of strings or null) — Allowlist of MCP tool names. If null, all tools are available.

### 4.6 Run Attempt

One execution of an agent in a workspace.

Fields:

- `_id` (Id<"runAttempts">)
- `workspaceId` (Id<"workspaces">)
- `projectId` (optional Id<"projects">) — Denormalized from the workspace for project-scoped indexes (`by_project_started`). Set on create/complete; older rows are backfilled via migration.
- `tokenUsageDailyBackfilled` (optional boolean) — Set when this attempt’s usage is reflected in `tokenUsageDaily` (live `complete`/`abandon` or historical backfill).
- `type` (string) — One of: `coding`, `review`, `conflict_resolution`. Indicates the purpose of this run.
- `attemptNumber` (number) — 1-based.
- `prompt` (optional string) — Legacy inline field. New attempts store the full prompt in the `runAttemptPrompts` table so bulk queries (e.g. token stats) do not read large strings. `api.workspaces.get` resolves the effective prompt for the UI.
- `status` (string) — One of: `running`, `succeeded`, `failed`, `timed_out`, `cancelled`.
- `exitCode` (number or null)
- `startedAt` (number)
- `finishedAt` (number or null)
- `error` (string or null)
- `tokenUsage` (object or null) — `{ inputTokens, outputTokens, totalTokens }`.
- **Project token stats:** `api.stats.tokenUsage` aggregates in a time window (default: last 90 days; optional `startTime` / `endTime` in epoch ms). For each full UTC day in range, it loads `tokenUsageDaily` rows for that day and **also** merges any `runAttempts` with `projectId` that still have `tokenUsageDailyBackfilled !== true` for that day, so rollout/backfill never drops unaggregated attempts. If a day has no daily rows yet, it sums raw indexed attempts for that day only. Partial UTC days (window edges) always use indexed `runAttempts` for the overlap interval. The query returns `abandonedRuns` (and per-status counts) so abandoned runs are visible separately from failed/timed out. Until at least one run attempt has `projectId`, the handler uses per-workspace `by_workspace_started` (legacy path). `runAttempts.complete` / `abandonRunning` upsert `tokenUsageDaily`; migrations backfill `projectId` then daily buckets (see `runAllSerialMigrations` in `convex/migrations.ts`: projectId migration first).

**Run attempt prompt (table `runAttemptPrompts`):** one row per attempt with `runAttemptId` and `prompt` (string), indexed by `runAttemptId`. Written by `runAttempts.create`; deleted when the parent workspace or project is removed.

### 4.7 Agent Log Entry

Individual log lines from agent execution, stored as separate Convex documents for real-time streaming.

Fields:

- `_id` (Id<"agentLogs">)
- `runAttemptId` (Id<"runAttempts">)
- `workspaceId` (Id<"workspaces">)
- `timestamp` (number) — Unix timestamp ms.
- `stream` (string) — `stdout` or `stderr`.
- `line` (string) — Raw line content.
- `structured` (object or null) — Parsed JSON for agents that output structured data (e.g. Claude Code stream-json).

### 4.8 Repository

A configured git repository within a project.

Fields:

- `_id` (Id<"repos">)
- `projectId` (Id<"projects">)
- `name` (string) — Human-readable name (e.g. "frontend").
- `slug` (string) — Used for worktree directory naming.
- `path` (string) — Absolute path to the git repository on disk.
- `defaultBranch` (string) — Default base branch for worktrees (e.g. `main`).
- `setupScript` (string or null) — Shell command to run after worktree creation (e.g. `bun install`).
- `beforeRunScript` (string or null) — Shell command to run before each agent run attempt.
- `afterRunScript` (string or null) — Shell command to run after each agent run attempt.
- `cleanupScript` (string or null) — Shell command to run before worktree removal.
- `scriptTimeoutMs` (number) — Timeout for all hook scripts. Default: `120000` (2 minutes).
- `testCommand` (string or null) — Shell command to run tests (e.g. `bun test`). If null, testing stage is skipped.
- `testTimeoutMs` (number) — Timeout for the test command. Default: `300000` (5 minutes).

### 4.9 Attachment

File attachments for issues. The binary is stored in Convex file storage; metadata is a document.

Fields:

- `_id` (Id<"attachments">)
- `issueId` (Id<"issues">)
- `storageId` (Id<"_storage">) — Convex file storage reference.
- `filename` (string)
- `mimeType` (string)
- `size` (number) — Bytes.
- `createdAt` (number)

## 5. Convex Schema

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    slug: v.string(),
    simpleIdPrefix: v.string(),
    simpleIdCounter: v.number(),
    defaultAgentConfigId: v.optional(v.id("agentConfigs")),
    planningAgentConfigId: v.optional(v.id("agentConfigs")),
    reviewAgentConfigId: v.optional(v.id("agentConfigs")),
    maxReviewCycles: v.number(),
    cleanupDelayMs: v.number(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  columns: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
    position: v.number(),
    visible: v.boolean(),
    autoDispatch: v.boolean(),
    mergePolicy: v.optional(v.string()),
    skipReview: v.boolean(),
    skipTests: v.boolean(),
  }).index("by_project", ["projectId"]),

  issues: defineTable({
    projectId: v.id("projects"),
    simpleId: v.string(),
    title: v.string(),
    description: v.string(),
    status: v.string(),
    tags: v.array(v.string()),
    blockedBy: v.optional(v.array(v.id("issues"))),
    position: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"]),

  repos: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.string(),
    path: v.string(),
    defaultBranch: v.string(),
    setupScript: v.optional(v.string()),
    beforeRunScript: v.optional(v.string()),
    afterRunScript: v.optional(v.string()),
    cleanupScript: v.optional(v.string()),
    scriptTimeoutMs: v.number(),
    testCommand: v.optional(v.string()),
    testTimeoutMs: v.number(),
  }).index("by_project", ["projectId"]),

  agentConfigs: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    agentType: v.string(),
    command: v.string(),
    args: v.array(v.string()),
    model: v.optional(v.string()),
    timeoutMs: v.number(),
    maxRetries: v.number(),
    retryBackoffMs: v.number(),
    maxRetryBackoffMs: v.number(),
    env: v.optional(v.any()),
    mcpEnabled: v.boolean(),
    mcpTools: v.optional(v.array(v.string())),
  }).index("by_project", ["projectId"]),

  workspaces: defineTable({
    issueId: v.optional(v.id("issues")),
    projectId: v.id("projects"),
    worktrees: v.array(
      v.object({
        repoId: v.id("repos"),
        repoPath: v.string(),
        baseBranch: v.string(),
        branchName: v.string(),
        worktreePath: v.string(),
      })
    ),
    status: v.string(),
    agentConfigId: v.id("agentConfigs"),
    agentCwd: v.string(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_issue", ["issueId"])
    .index("by_status", ["status"])
    .index("by_project", ["projectId"]),

  runAttempts: defineTable({
    workspaceId: v.id("workspaces"),
    type: v.string(),
    attemptNumber: v.number(),
    prompt: v.optional(v.string()),
    status: v.string(),
    exitCode: v.optional(v.number()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        totalTokens: v.number(),
      })
    ),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_started", ["workspaceId", "startedAt"]),

  runAttemptPrompts: defineTable({
    runAttemptId: v.id("runAttempts"),
    prompt: v.string(),
  }).index("by_runAttempt", ["runAttemptId"]),

  agentLogs: defineTable({
    runAttemptId: v.id("runAttempts"),
    workspaceId: v.id("workspaces"),
    timestamp: v.number(),
    stream: v.string(),
    line: v.string(),
    structured: v.optional(v.any()),
  })
    .index("by_run_attempt", ["runAttemptId", "timestamp"])
    .index("by_workspace", ["workspaceId", "timestamp"]),

  comments: defineTable({
    issueId: v.id("issues"),
    body: v.string(),
    author: v.string(),
    runAttemptId: v.optional(v.id("runAttempts")),
    createdAt: v.number(),
  })
    .index("by_issue", ["issueId", "createdAt"])
    .index("by_run_attempt", ["runAttemptId"]),

  attachments: defineTable({
    issueId: v.id("issues"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  }).index("by_issue", ["issueId"]),
});
```

## Migrations

Schema and data changes that must apply to **existing** deployments are handled with [`@convex-dev/migrations`](https://www.convex.dev/components/migrations). The component is registered in `convex/convex.config.ts`. Migration state is stored by the component so a long-idle instance can run the full queue once after upgrade.

**Define a migration** in `convex/migrations.ts` using `migrations.define()` (see the package README). Each migration is an internal mutation over a table’s documents.

**Register it in the serial runner** by adding `internal.migrations.yourMigration` to the array passed to `migrations.runSerially` inside `runAll`. Keep that list in **chronological order** (oldest first).

**Access control:** Migration entrypoints are **internal** — they are **not** on the public `api` object (no `useMutation(api.migrations.*)`). The `Migrations` helper is constructed with `internalMutation` from `./_generated/server` so `define()` migrations match that model. The generic CLI runner (`run`) comes from `migrations.runner()`, which the library implements with Convex’s internal mutation registration (same visibility as `runAll`). Reference them from server code as `internal.migrations.run`, `internal.migrations.runAll`, or `internal.migrations.yourMigration`. `bun run migrate` and `bunx convex run migrations:runAll` / `migrations:run` use the **Convex CLI with admin credentials** from your project (e.g. deployment admin key), the same trust model as other operator-only `convex run` commands.

The `@convex-dev/migrations` version is pinned exactly in `package.json` so upgrades are explicit when validating against the component API.

**Run migrations** after deploying or pushing schema/code:

- **Local dev:** `bun run dev` runs `bun run migrate` automatically **once** after the first successful push in that session (`dev:convex` uses `convex dev --run-sh ./scripts/run-migrate-after-dev-push.sh`). This requires the **Convex CLI** from the repo’s `convex` dependency (includes `--run-sh`; use a matching `bunx convex` / local install). Later file edits only re-push; they do not run the migrate hook again until you restart dev.
- Run the full serial list manually: `bun run migrate` (same as `bunx convex run migrations:runAll`).
- Run a single migration by name via the generic runner: `bunx convex run migrations:run '{"fn":"migrations:myMigration"}'`.

**Status and cancel** (component API):

- Status: `bun run migrate:status` (same as `bunx convex run --component migrations lib:getStatus`). Add `--watch` to stream updates while a migration runs.
- Cancel one in-progress migration: `bunx convex run --component migrations lib:cancel '{"name":"migrations:myMigration"}'`.

**Typical five-step workflow** for a schema change:

1. Relax the schema so old and new shapes are valid (e.g. optional field, or union of values).
2. Define the migration and add it to the `runAll` list.
3. Push (`bunx convex deploy` or `bunx convex dev` as appropriate).
4. Run migrations (`bun run migrate`) until complete; use `migrate:status` to confirm.
5. Tighten the schema and application code to the new shape only.

## 6. Interface Contracts (TypeScript Pseudocode)

These interfaces define the boundaries between components. Each can be implemented and tested independently, enabling parallel development.

### 6.1 Convex Function Interfaces

These are the Convex query/mutation/action signatures that the Web UI depends on and the Worker calls into.

```typescript
// ─── PROJECT FUNCTIONS ───────────────────────────────────

// Query: list all projects
api.projects.list: () => Project[]

// Mutation: create a project with default columns
api.projects.create: (args: { name: string; slug: string; simpleIdPrefix: string }) => Id<"projects">

// Mutation: update project settings (includes workflow: mergePolicy, skipReview, skipTests, skipPlanning, autoPlanReview, maxConcurrent, etc.)
api.projects.update: (args: { id: Id<"projects">; name?: string; defaultAgentConfigId?: Id<"agentConfigs"> }) => void

// Mutation: delete a project and all its data (cascade deletes columns, issues, workspaces, repos, agent configs, and all nested records)
api.projects.remove: (args: { id: Id<"projects"> }) => void

// ─── COLUMN FUNCTIONS ────────────────────────────────────

// Query: list columns for a project, sorted by position (always four fixed columns)
api.columns.list: (args: { projectId: Id<"projects"> }) => Column[]

// Mutation: update column color only (cosmetic)
api.columns.update: (args: { id: Id<"columns">; color?: string }) => void

// ─── ISSUE FUNCTIONS ─────────────────────────────────────

// Query: list issues for a project with optional filters
api.issues.list: (args: {
  projectId: Id<"projects">;
  status?: string;
  tags?: string[];
  search?: string;
}) => Issue[]

// Query: get a single issue with workspace count
api.issues.get: (args: { id: Id<"issues"> }) => Issue & {
  workspaceCount: number;
}

// Mutation: create an issue (auto-generates simpleId; status must be Backlog or To Do; To Do triggers auto-dispatch when a default agent is set)
api.issues.create: (args: {
  projectId: Id<"projects">;
  title: string;
  description: string;
  status: string;
  tags?: string[];
}) => Id<"issues">

// Mutation: update issue fields (does not include status/position — use issues.move for column changes)
api.issues.update: (args: {
  id: Id<"issues">;
  title?: string;
  description?: string;
  tags?: string[];
  blockedBy?: Id<"issues">[];
  deepResearch?: boolean;
  autoMerge?: boolean;
  actor?: "user" | "agent";
}) => void

// Mutation: move issue to a new status (triggers auto-dispatch if target status is To Do).
// Optional `actor` (default user): agents cannot move to terminal columns (e.g. Done).
api.issues.move: (args: {
  id: Id<"issues">;
  status: string;
  position: number;
  actor?: "user" | "agent";
}) => void

// Mutation: delete an issue and its attachments
api.issues.remove: (args: { id: Id<"issues"> }) => void

// ─── BULK ISSUE OPERATIONS ──────────────────────────────

// Mutation: move multiple issues to a target column (with auto-dispatch)
api.bulkIssues.bulkMove: (args: { ids: Id<"issues">[]; status: string }) => void

// Mutation: add tags to multiple issues (merges with existing, no duplicates)
api.bulkIssues.bulkAddTags: (args: { ids: Id<"issues">[]; tags: string[] }) => void

// Mutation: remove tags from multiple issues
api.bulkIssues.bulkRemoveTags: (args: { ids: Id<"issues">[]; tags: string[] }) => void

// Mutation: delete multiple issues with cascade (comments + attachments)
api.bulkIssues.bulkDelete: (args: { ids: Id<"issues">[] }) => void

// ─── WORKSPACE FUNCTIONS ─────────────────────────────────

// Query: list workspaces for an issue
api.workspaces.listByIssue: (args: { issueId: Id<"issues"> }) => Workspace[]

// Query: list all active workspaces (for worker dashboard)
api.workspaces.listActive: () => Workspace[]

// Query: get workspace with run attempts
api.workspaces.get: (args: { id: Id<"workspaces"> }) => Workspace & {
  runAttempts: RunAttempt[];
  agentConfig: AgentConfig;
}

// Mutation: create a workspace record (worker will create actual worktrees)
api.workspaces.create: (args: {
  issueId?: Id<"issues">;
  projectId: Id<"projects">;
  agentConfigId: Id<"agentConfigs">;
  additionalPrompt?: string;
}) => Id<"workspaces">

// Mutation: update workspace status and worktree paths (called by worker after git operations)
api.workspaces.updateStatus: (args: {
  id: Id<"workspaces">;
  status: string;
  worktrees?: WorktreeEntry[];
  agentCwd?: string;
  completedAt?: number;
}) => void

// Mutation: move a terminal workspace that still has worktrees to `cancelled` so the worker cleans worktrees (same pipeline as cancel/finish)
api.workspaces.abandon: (args: { id: Id<"workspaces"> }) => void
// — Only for terminal statuses with a non-empty worktrees array. Active workspaces must use requestCancel instead. Empty worktrees: use remove.

// Mutation: delete a terminal workspace record after worktrees are empty (cascades related rows)
api.workspaces.remove: (args: { id: Id<"workspaces"> }) => void
// — Only allowed when status is terminal (completed, failed, cancelled, merged, merge_failed, conflict, test_failed, changes_requested) and worktrees array is empty.
// — Before deleting run attempts, clears optional comments.runAttemptId for those attempts so issue comments are not left pointing at deleted rows.
// — There is no separate reviewComments table; PR/code review notes use feedbackMessages, agentQuestions, and workspace fields such as reviewFeedback.

// ─── RUN ATTEMPT FUNCTIONS ───────────────────────────────

// Query: get logs for a run attempt (paginated, real-time)
api.agentLogs.list: (args: {
  runAttemptId: Id<"runAttempts">;
  after?: number;  // timestamp cursor for pagination
  limit?: number;
}) => AgentLogEntry[]

// Query: latest run attempt for a workspace with the given `type` (by workspace attempt order)
api.runAttempts.lastByType: (args: {
  workspaceId: Id<"workspaces">;
  type: string;
}) => { /* runAttempts table fields */ } | null

// Mutation: create a run attempt (called when starting an agent)
api.runAttempts.create: (args: {
  workspaceId: Id<"workspaces">;
  prompt: string;
}) => Id<"runAttempts">

// Mutation: append a log line (called by worker during agent execution)
api.agentLogs.append: (args: {
  runAttemptId: Id<"runAttempts">;
  workspaceId: Id<"workspaces">;
  stream: "stdout" | "stderr";
  line: string;
  structured?: any;
}) => void

// Mutation: batch append log lines (for efficiency)
api.agentLogs.appendBatch: (args: {
  entries: Array<{
    runAttemptId: Id<"runAttempts">;
    workspaceId: Id<"workspaces">;
    stream: "stdout" | "stderr";
    line: string;
    structured?: any;
  }>;
}) => void

// Mutation: complete a run attempt
api.runAttempts.complete: (args: {
  id: Id<"runAttempts">;
  status: "succeeded" | "failed" | "timed_out" | "cancelled";
  exitCode?: number;
  error?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}) => void

// ─── AGENT CONFIG FUNCTIONS ──────────────────────────────

api.agentConfigs.list: (args: { projectId: Id<"projects"> }) => AgentConfig[]
api.agentConfigs.create: (args: { projectId: Id<"projects">; ...AgentConfig fields }) => Id<"agentConfigs">
api.agentConfigs.update: (args: { id: Id<"agentConfigs">; ...partial fields }) => void
api.agentConfigs.remove: (args: { id: Id<"agentConfigs"> }) => void

// ─── REPO FUNCTIONS ──────────────────────────────────────

api.repos.list: (args: { projectId: Id<"projects"> }) => Repo[]
api.repos.create: (args: { projectId: Id<"projects">; ...Repo fields }) => Id<"repos">
api.repos.update: (args: { id: Id<"repos">; ...partial fields }) => void
api.repos.remove: (args: { id: Id<"repos"> }) => void

// ─── ATTACHMENT FUNCTIONS ────────────────────────────────

api.attachments.list: (args: { issueId: Id<"issues"> }) => Attachment[]
api.attachments.generateUploadUrl: () => string  // Convex file upload URL
api.attachments.create: (args: { issueId: Id<"issues">; storageId: Id<"_storage">; filename: string; mimeType: string; size: number }) => Id<"attachments">
api.attachments.remove: (args: { id: Id<"attachments"> }) => void

// ─── DISPATCH FUNCTIONS ──────────────────────────────────

// Query: get next pending dispatch for the worker to claim
api.dispatch.next: () => {
  workspaceId: Id<"workspaces">;
  issueId?: Id<"issues">;
  projectId: Id<"projects">;
  agentConfig: AgentConfig;
  repos: Repo[];
  issue?: Issue;
  additionalPrompt?: string;
} | null

// Mutation: worker claims a workspace for execution
api.dispatch.claim: (args: { workspaceId: Id<"workspaces"> }) => boolean

// Query: whether this workspace may transition into the given phase (global + per-project per-phase limits)
api.dispatch.canEnterPhase: (args: {
  workspaceId: Id<"workspaces">;
  phase: "planning" | "coding" | "testing" | "reviewing";
}) => boolean

// Query: system status for dashboard
api.dispatch.status: () => {
  runningCount: number;
  queuedCount: number;
  maxConcurrent: number;
  maxConcurrentPlanning?: number;
  maxConcurrentCoding?: number;
  maxConcurrentTesting?: number;
  maxConcurrentReviewing?: number;
  phaseCounts: { planning: number; coding: number; testing: number; reviewing: number };
  lastPollAt: number | null;
  workerConnected: boolean;
  recentCompletions: Array<{ workspaceId: Id<"workspaces">; status: string; finishedAt: number }>;
}
```

### 6.2 Worker Interface

The worker is a standalone Bun process. It depends on Convex functions (above) and local system interfaces (below).

```typescript
// ─── WORKER MAIN LOOP ────────────────────────────────────

interface WorkerConfig {
  convexUrl: string;               // URL of the Convex instance
  maxConcurrentAgents: number;     // Default: 3
  stallTimeoutMs: number;          // Default: 300000 (5 min)
  defaultAgentTimeoutMs: number;   // Default: 3600000 (1 hour)
  worktreeRoot: string;            // Default: ~/.yes-kanban/worktrees
  pollIntervalMs: number;          // How often to check for new work. Default: 3000
}

// Worker lifecycle pseudocode:
//
// async function workerMain(config: WorkerConfig) {
//   const convex = new ConvexClient(config.convexUrl);
//   const slots = new Semaphore(config.maxConcurrentAgents);
//
//   while (true) {
//     if (slots.available > 0) {
//       const task = await convex.query(api.dispatch.next);
//       if (task) {
//         const claimed = await convex.mutation(api.dispatch.claim, { workspaceId: task.workspaceId });
//         if (claimed) {
//           slots.acquire();
//           executeTask(convex, config, task).finally(() => slots.release());
//         }
//       }
//     }
//     await sleep(config.pollIntervalMs);
//   }
// }

// ─── GIT WORKTREE MANAGER ────────────────────────────────

interface IWorktreeManager {
  // Create worktrees for all repos in the project.
  // Returns the populated WorktreeEntry[] and the agent cwd path.
  createWorktrees(args: {
    workspaceId: string;
    simpleId: string;
    repos: Repo[];
  }): Promise<{ worktrees: WorktreeEntry[]; agentCwd: string }>;

  // Remove all worktrees for a workspace.
  removeWorktrees(args: {
    worktrees: WorktreeEntry[];
    repos: Repo[];
  }): Promise<void>;

  // Get git diff for a worktree (branch vs base).
  getDiff(worktreePath: string, baseBranch: string): Promise<string>;

  // Get list of changed files.
  getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]>;
}

// Worktree creation pseudocode:
//
// async createWorktrees({ workspaceId, simpleId, repos }) {
//   const worktrees: WorktreeEntry[] = [];
//   const workspaceDir = path.join(this.worktreeRoot, workspaceId);
//   await fs.mkdir(workspaceDir, { recursive: true });
//
//   for (const repo of repos) {
//     const branchName = `yes-kanban/${simpleId}`;
//     const worktreePath = repos.length === 1
//       ? workspaceDir  // single repo: worktree IS the workspace dir
//       : path.join(workspaceDir, repo.slug);
//
//     await exec(`git -C ${repo.path} worktree add -b ${branchName} ${worktreePath} ${repo.defaultBranch}`);
//
//     if (repo.setupScript) {
//       await execWithTimeout(repo.setupScript, { cwd: worktreePath, timeout: repo.scriptTimeoutMs });
//     }
//
//     worktrees.push({ repoId: repo._id, repoPath: repo.path, baseBranch: repo.defaultBranch, branchName, worktreePath });
//   }
//
//   const agentCwd = repos.length === 1 ? worktrees[0].worktreePath : workspaceDir;
//   return { worktrees, agentCwd };
// }

// ─── AGENT ADAPTER INTERFACE ─────────────────────────────

interface IAgentAdapter {
  // Build the full command + args for launching this agent.
  buildCommand(args: {
    config: AgentConfig;
    prompt: string;
    cwd: string;
  }): { command: string; args: string[]; env: Record<string, string> };

  // Parse a stdout line into a structured event (or null if plain text).
  parseLine(line: string): AgentEvent | null;

  // Extract token usage from agent output (called at end of run).
  extractTokenUsage(events: AgentEvent[]): TokenUsage | null;
}

type AgentEvent = {
  type: "assistant_message" | "tool_use" | "tool_result" | "token_usage" | "error" | "completion" | "unknown";
  data: any;
};

// ─── CLAUDE CODE ADAPTER (implements IAgentAdapter) ──────

// buildCommand pseudocode:
//
// buildCommand({ config, prompt, cwd }) {
//   return {
//     command: config.command,  // "claude"
//     args: [
//       "--dangerously-skip-permissions",
//       "-p", prompt,
//       "--output-format", "stream-json",
//       ...(config.model ? ["--model", config.model] : []),
//       ...config.args,
//     ],
//     env: { ...process.env, ...config.env },
//   };
// }

// ─── AGENT EXECUTOR ──────────────────────────────────────

interface IAgentExecutor {
  // Start an agent subprocess and stream output.
  // Calls onLine for each stdout/stderr line.
  // Returns when the process exits.
  execute(args: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
    timeoutMs: number;
    stallTimeoutMs: number;
    onLine: (stream: "stdout" | "stderr", line: string) => void;
    signal: AbortSignal;  // For cancellation
  }): Promise<{ exitCode: number; timedOut: boolean; stalled: boolean }>;
}

// Execute pseudocode:
//
// async execute({ command, args, env, cwd, timeoutMs, stallTimeoutMs, onLine, signal }) {
//   const proc = Bun.spawn([command, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
//   let lastActivity = Date.now();
//
//   const overallTimer = setTimeout(() => proc.kill(), timeoutMs);
//   const stallChecker = setInterval(() => {
//     if (Date.now() - lastActivity > stallTimeoutMs) proc.kill();
//   }, 10000);
//
//   signal.addEventListener("abort", () => {
//     proc.kill("SIGTERM");
//     setTimeout(() => proc.kill("SIGKILL"), 5000);
//   });
//
//   // Stream stdout/stderr lines, call onLine for each, update lastActivity
//   // ... (readline from proc.stdout and proc.stderr)
//
//   const exitCode = await proc.exited;
//   clearTimeout(overallTimer);
//   clearInterval(stallChecker);
//   return { exitCode, timedOut: ..., stalled: ... };
// }

// ─── FORGE ADAPTER INTERFACE ─────────────────────────────

interface IForgeAdapter {
  // Check if the CLI tool is installed and authenticated.
  checkAvailability(): Promise<{ available: boolean; error?: string }>;

  // Create a pull request for a worktree. Returns the PR URL.
  createPullRequest(args: {
    worktreePath: string;
    repoPath: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<{ url: string }>;

  // Check if a PR exists for a branch.
  getPullRequestStatus(args: {
    repoPath: string;
    branch: string;
  }): Promise<{ exists: boolean; url?: string; status?: string } | null>;
}

// ─── TASK EXECUTION FLOW (ties it all together) ──────────

// async function executeTask(convex, config, task) {
//   const { workspaceId, agentConfig, repos, issue } = task;
//
//   // 1. Create worktrees
//   const worktreeManager: IWorktreeManager = new GitWorktreeManager(config.worktreeRoot);
//   const { worktrees, agentCwd } = await worktreeManager.createWorktrees({
//     workspaceId, simpleId: issue.simpleId, repos,
//   });
//   await convex.mutation(api.workspaces.updateStatus, {
//     id: workspaceId, status: "ready", worktrees, agentCwd,
//   });
//
//   // 2. Build prompt
//   const prompt = buildPrompt(issue, task.additionalPrompt);
//
//   // 3. Create run attempt
//   const runAttemptId = await convex.mutation(api.runAttempts.create, { workspaceId, prompt });
//   await convex.mutation(api.workspaces.updateStatus, { id: workspaceId, status: "running" });
//
//   // 4. Launch agent
//   const adapter: IAgentAdapter = getAdapter(agentConfig.agentType);
//   const { command, args, env } = adapter.buildCommand({ config: agentConfig, prompt, cwd: agentCwd });
//
//   const executor: IAgentExecutor = new AgentExecutor();
//   const logBuffer: AgentLogEntry[] = [];
//   const flushLogs = debounce(async () => {
//     if (logBuffer.length > 0) {
//       await convex.mutation(api.agentLogs.appendBatch, { entries: logBuffer.splice(0) });
//     }
//   }, 100);
//
//   const result = await executor.execute({
//     command, args, env, cwd: agentCwd,
//     timeoutMs: agentConfig.timeoutMs,
//     stallTimeoutMs: config.stallTimeoutMs,
//     onLine: (stream, line) => {
//       const structured = adapter.parseLine(line);
//       logBuffer.push({ runAttemptId, workspaceId, stream, line, structured, timestamp: Date.now() });
//       flushLogs();
//     },
//     signal: abortController.signal,
//   });
//
//   await flushLogs.flush();
//
//   // 5. Record result
//   const status = result.exitCode === 0 ? "succeeded"
//     : result.timedOut ? "timed_out"
//     : result.stalled ? "failed"
//     : "failed";
//
//   await convex.mutation(api.runAttempts.complete, {
//     id: runAttemptId, status, exitCode: result.exitCode,
//     error: result.timedOut ? "Agent timed out" : result.stalled ? "Agent stalled" : undefined,
//     tokenUsage: adapter.extractTokenUsage(collectedEvents),
//   });
//
//   await convex.mutation(api.workspaces.updateStatus, {
//     id: workspaceId,
//     status: status === "succeeded" ? "completed" : "failed",
//     completedAt: Date.now(),
//   });
// }
```

### 6.3 Web UI Component Interfaces

The React components depend only on Convex queries and mutations. No direct communication with the worker.

```typescript
// ─── KEY REACT HOOKS (using Convex React client) ─────────

// Board view: reactive list of issues grouped by column
function useBoardData(projectId: Id<"projects">) {
  const columns = useQuery(api.columns.list, { projectId });
  const issues = useQuery(api.issues.list, { projectId });
  // Group issues by status, sorted by position within each column
  return { columns, issuesByColumn };
}

// Issue detail: reactive issue + workspaces
function useIssueDetail(issueId: Id<"issues">) {
  const issue = useQuery(api.issues.get, { id: issueId });
  const workspaces = useQuery(api.workspaces.listByIssue, { issueId });
  const attachments = useQuery(api.attachments.list, { issueId });
  return { issue, workspaces, attachments };
}

// Workspace view: reactive workspace + live agent logs
function useWorkspaceView(workspaceId: Id<"workspaces">) {
  const workspace = useQuery(api.workspaces.get, { id: workspaceId });
  // For the active run attempt, subscribe to logs
  const activeAttempt = workspace?.runAttempts.find(a => a.status === "running");
  const logs = useQuery(
    api.agentLogs.list,
    activeAttempt ? { runAttemptId: activeAttempt._id, limit: 200 } : "skip"
  );
  return { workspace, logs };
}

// Drag and drop: mutation to move issue between columns
function useMoveIssue() {
  const move = useMutation(api.issues.move);
  return (issueId: Id<"issues">, newStatus: string, position: number) =>
    move({ id: issueId, status: newStatus, position });
}
```

## 7. Board and Column Management

### 7.1 Fixed columns

New projects are created with exactly these columns (all visible):

| Position | Name          | Color   | Auto-dispatch |
| -------- | ------------- | ------- | ------------- |
| 0        | Backlog       | #6B7280 | no            |
| 1        | To Do         | #3B82F6 | yes           |
| 2        | In Progress   | #F59E0B | no            |
| 3        | Done          | #10B981 | no            |

New issues may be created only in **Backlog** or **To Do**. Workflow automation (merge policy, skip review/tests, planning toggles, per-project concurrency) is configured on the **project**, not per column.

### 7.2 Project Deletion

- Deleting a project removes all associated data: columns, issues (with comments and attachments), workspaces (with run attempts and agent logs), repositories, and agent configurations.
- Active workspaces are terminated before deletion.
- This operation is irreversible.

### 7.3 Column operations

- Only **color** can be changed (`api.columns.update` with `color`).
- Column add/remove/rename/reorder/visibility are not supported.

### 7.4 Auto-dispatch

- Only **To Do** auto-dispatches: creating or moving an issue into **To Do** queues a workspace when a default agent config is set.
- The dispatcher creates a workspace and the worker picks it up for execution.
- If no default agent config is set, auto-dispatch is a no-op.

## 8. Workspace Management

### 8.1 Git Worktree Lifecycle

Creating a workspace (performed by the Worker via `IWorktreeManager`):

1. For **each** repository configured in the project:
   a. Validate that the source repository exists and is a git repo.
   b. Generate a branch name: `yes-kanban/<project-slug>/<simple-id>` (e.g. `yes-kanban/myproject/TASK-42`).
   c. Create a git worktree from the specified base branch: `git worktree add -b <branch> <worktree-path> <base-branch>`.
   d. Run setup hooks if configured (e.g. `bun install`). Setup hooks are also responsible for copying any agent-specific config files (e.g. `CLAUDE.md`, `.claude/`) into the worktree if needed.
   e. **Once per workspace:** After a `setup` run attempt has completed with status **succeeded** in Convex, later lifecycle dispatches skip `setupScript` even when worktrees must be recreated on disk (e.g. separate dispatches for planning and coding). A failed setup is not treated as complete; the script runs again on the next dispatch until it succeeds.
2. Set the workspace `agentCwd` to the workspace root directory (containing all worktrees).
3. Update workspace status to `ready` in Convex.

If any repo fails worktree creation, the entire workspace creation fails and any already-created worktrees for this workspace are cleaned up.

Cleanup:

- On workspace deletion, remove **all** git worktrees for the workspace.
- Run cleanup hooks for each repo if configured.
- Branches are not auto-deleted (may be needed for PRs).

### 8.2 Workspace Directory Layout

Each workspace gets a directory that contains one subdirectory per repo worktree:

```
<worktree_root>/
  <workspace-id>/
    <repo-slug-1>/        # Git worktree for first repo
      .git
      ...repo files...
    <repo-slug-2>/        # Git worktree for second repo
      .git
      ...repo files...
```

For single-repo projects, the agent `cwd` is set directly to the worktree path for simplicity.

### 8.3 Multiple Workspaces Per Issue

An issue can have multiple workspaces. This supports parallel attempts with different agents or configurations, retrying with a fresh set of worktrees, or different base branches.

### 8.4 Standalone Workspaces

Workspaces can be created without an associated issue. Useful for quick one-off agent tasks or exploratory work.

### 8.5 Workspace Hooks

Each repository can configure lifecycle hooks that run at specific points in the workspace lifecycle:

Supported hooks:

- `setupScript` (alias: `after_create`) — Runs after worktree creation. E.g. `bun install`.
- `beforeRunScript` — Runs before each agent run attempt. E.g. pull latest from base branch, reset state.
- `afterRunScript` — Runs after each agent run attempt (success or failure). E.g. collect artifacts, run linters.
- `cleanupScript` (alias: `before_remove`) — Runs before worktree removal. E.g. save logs, archive artifacts.

Execution contract:

- Hooks execute in a shell with the worktree directory as `cwd`.
- Hook timeout uses `scriptTimeoutMs` per repo; default: `120000 ms` (2 minutes).
- Log hook start, completion, failures, and timeouts.

Failure semantics:

- `setupScript` failure or timeout is fatal to workspace creation. Partially created worktrees are cleaned up.
- `beforeRunScript` failure or timeout is fatal to the current run attempt. Workspace is preserved.
- `afterRunScript` failure or timeout is logged and ignored. Does not affect run attempt status.
- `cleanupScript` failure or timeout is logged and ignored. Worktree removal proceeds.

### 8.6 Agent Config in Worktrees

Agent-specific configuration files (e.g. `CLAUDE.md`, `.claude/settings.local.json`, `AGENTS.md`) are NOT automatically present in git worktrees unless they are committed to the repository. For reproducible setups, the recommended approach is:

- Commit agent config files to the repo (they will be in every worktree).
- Or use the repo's `setupScript` to copy config files from a known location into the worktree.

This is intentional — worktrees should provide a clean, reproducible environment.

### 8.7 Workspace Safety Invariants

Invariant 1: Run the coding agent only within the workspace directory.

- Before launching the agent subprocess, validate that `cwd` is the workspace path.

Invariant 2: Workspace path must stay inside workspace root.

- Normalize both paths to absolute.
- Require `worktreePath` to have `worktreeRoot` as a prefix directory.
- Reject any path outside the workspace root.

Invariant 3: Branch names are sanitized.

- Branch names use the pattern `yes-kanban/<project-slug>/<simple-id>`.
- Only `[A-Za-z0-9._-/]` allowed. Replace all other characters with `_`.

## 9. Agent Execution

### 9.1 Agent Adapter Interface

See `IAgentAdapter` in Section 6.2. Agents are launched through an adapter interface. Each adapter knows how to build the CLI command, parse stdout, detect completion, and extract token usage.

### 9.2 Claude Code Adapter (Default)

Launch command: `claude --dangerously-skip-permissions -p <prompt> --output-format stream-json`

Behavior:

- The prompt is the issue title + description + any user-provided additional instructions.
- `--dangerously-skip-permissions` enables autonomous execution (no interactive approval prompts).
- `--output-format stream-json` produces line-delimited JSON on stdout for real-time streaming.
- Working directory is the worktree path.
- Environment variables from the agent config are merged with the current environment.
- **Skills and Claude settings** are not managed inside Yes Kanban. Agents inherit the user’s normal Claude Code settings and skills from the project and home directory. The worker may pass a minimal `--settings` JSON path used only for commit/PR attribution placeholders; it does not disable slash commands or strip setting sources.

Stdout parsing:

- Each line of stdout is parsed as JSON.
- Events include assistant messages, tool use, token usage updates, and completion signals.
- All output is captured to Convex `agentLogs` and streamed to the UI via Convex subscriptions.

Completion detection:

- Process exit code 0: success.
- Process exit code non-zero: failure.
- No output for `stallTimeoutMs`: stalled, kill and optionally retry.
- Total runtime exceeds `timeoutMs`: timed out, kill.

#### Stall Detection (Detailed)

A "stall" means the agent subprocess is alive but producing no output. This can happen when the agent is stuck in an infinite loop, waiting for network, or deadlocked.

Detection mechanism:

- Track `lastActivityTimestamp` — updated every time a stdout or stderr line is received.
- On the first line of output, set `lastActivityTimestamp = now()`.
- If no output has ever been received, use `startedAt` as the baseline.
- The worker checks periodically (every 10 seconds) whether `now() - lastActivityTimestamp > stallTimeoutMs`.
- If stalled:
  1. Send SIGTERM to the agent subprocess.
  2. Wait up to 5 seconds for graceful shutdown.
  3. If still running, send SIGKILL.
  4. Record the run attempt as `failed` with error `Agent stalled (no output for ${stallTimeoutMs}ms)`.
  5. If auto-retry is enabled, schedule a retry with exponential backoff.
- If `stallTimeoutMs <= 0`, stall detection is disabled entirely.

### 9.3 Additional Agent Adapters

The adapter interface accommodates agents with different CLI conventions:

- Different argument formats for passing prompts (stdin, flag, file).
- Different output formats (plain text, JSON, streaming).
- Different completion signals.

Required adapters:

- **Claude Code** (`claude-code`) — Default. See Section 9.2.
- **Codex CLI** (`codex`) — `bunx -y @openai/codex`. Prompt via flag. Plain text stdout.
- **Cursor Agent CLI** (`cursor`) — `cursor-agent`. Prompt via flag. Plain text stdout.

Each adapter implements `IAgentAdapter` from Section 6.2. Non-Claude adapters output plain text, so the log viewer displays raw output without structured event parsing.

### 9.4 Prompt Construction

The prompt sent to the agent is assembled from:

1. **Issue context** — Title, description, and acceptance criteria from the issue body.
2. **Workspace context** — Repository name(s), branch name, base branch.
3. **Template instructions** — Customizable prompt templates (see Section 9.4.1). Falls back to built-in defaults if no template is configured.
4. **User instructions** — Optional additional instructions provided at dispatch time via the UI.
5. **Continuation context** — If this is a retry or continuation, include what happened in the previous attempt.

#### 9.4.1 Prompt Templates

Prompt templates allow customization of the instructions sent to agents at different lifecycle stages. Templates are stored in the `promptTemplates` table and managed via the Settings UI.

**Template Types:**
- `workflow` — Instructions for the coding agent (replaces the default "Implement, self-review, run tests, commit" instructions).
- `review` — Criteria and output format for the review agent (replaces default review criteria and APPROVE/REQUEST_CHANGES format).
- `rebase` — Instructions for the rebase conflict resolution agent.

**Scoping (priority order):**
1. **Project-level** — Templates with a `projectId` override global defaults for that project.
2. **Global** — Templates with no `projectId` apply to all projects unless overridden.
3. **Built-in** — If no template is configured, hardcoded defaults are used.

**Placeholder interpolation:**
Templates support `{{placeholder}}` syntax:
- `{{issueId}}` — The issue's simple ID (e.g., "TASK-42").
- `{{title}}` — The issue title.
- `{{baseBranch}}` — The base branch name (rebase templates only).

**Schema:**
```
promptTemplates:
  projectId: optional Id<"projects">  // null = global
  name: string
  type: string  // "workflow" | "review" | "rebase"
  content: string
  isDefault: boolean
  createdAt: number
  updatedAt: number
```

### 9.5 Concurrency

#### Global Limit

- The worker has a configurable `maxConcurrentAgents` setting. Default: `3`.
- Each running agent occupies one slot.
- `availableSlots = max(maxConcurrentAgents - runningCount, 0)`.
- When all slots are full, the worker stops claiming new work.

#### Per-project limit (optional)

- `project.maxConcurrent` limits how many workspaces for that project can be in running agent states at once.
- If unset, only the global worker limit applies.
- The runtime counts running workspaces **per project** when this is set.

#### Per-phase limits (optional; YES-214)

- **Worker state** (`workerState`): optional `maxConcurrentPlanning`, `maxConcurrentCoding`, `maxConcurrentTesting`, `maxConcurrentReviewing` cap how many workspaces may be in those statuses **globally** (across all projects).
- **Project**: the same four optional fields cap per-phase concurrency **within that project**.
- Unset or cleared means **no** per-phase constraint for that phase. These apply **in addition** to `maxConcurrentAgents` and `project.maxConcurrent` (overall caps).
- **Validation**: `projects.update` and `dispatch.updateMaxConcurrent` reject numeric limits below `1` (server-side, not only the UI).
- `claimed` and `rebasing` do **not** count toward per-phase limits.
- Before entering a phase (including dispatch into the first phase: planning or coding), the worker checks capacity; if full, the lifecycle **polls every** ~3s until a slot is available or the run is cancelled. The agent slot from the overall worker semaphore is **not** released while waiting.
- **Optimistic checks**: `canEnterPhase` is a query, not a lock. Two workspaces can both observe free capacity and enter the same phase within one poll interval, temporarily exceeding the configured limit by at most a small number (typically one per cycle). The next check self-corrects; this is acceptable for solo-scale use.

#### Dispatch ordering

Queued workspaces (same global and per-project concurrency permitting) are dispatched **FIFO** by workspace `createdAt` (oldest first).

#### Blocker-Aware Dispatch

An issue is dispatch-eligible only if all of the following are true:

- It has a title and status.
- Its status is **To Do** (auto-dispatch path) or it was manually dispatched.
- It does not already have a running workspace.
- Global concurrency slots are available.
- Per-project concurrency slots are available (if `project.maxConcurrent` is set).
- **Blocker rule**: if the issue has `blockedBy` entries, none of those issues may be in a non-terminal column. An issue is considered "terminal" only if it is in **Done**.

If a blocked issue enters **To Do**, it is queued but not dispatched until its blockers clear. The worker checks blocker status each time it polls for work.

## 10. Dispatch and Orchestration

### 10.1 Manual Dispatch

The user can manually dispatch an agent from the UI:

1. Select an issue.
2. Click "Create Workspace".
3. Choose an agent configuration (and optionally override base branches).
4. Optionally provide additional instructions.
5. Click "Start".

The UI calls `api.workspaces.create`. The worker picks up the workspace via `api.dispatch.next` and executes it.

### 10.2 Auto-Dispatch and Default Flow Automation

When `api.issues.move` is called and the target status is **To Do** (or `api.issues.create` targets **To Do**):

1. The mutation creates a workspace record with status `creating` and the project's default agent config.
2. The worker picks it up, claims the workspace, and starts the agent.
3. On **claim**, if the project **skips** planning (`skipPlanning` is `true` or unset/legacy), **To Do** auto-moves to **In Progress**. If the project **runs** planning (`skipPlanning === false`), the issue **stays in To Do** until `approvePlan` moves it to **In Progress** (never into **Done**).

**Default flow** (convention-over-configuration):

- **Backlog** or **To Do** → user creates issue (only these columns) or moves to **To Do** → workspace queued when a default agent is set
- **To Do** → worker claims → either stay in **To Do** (planning) or auto-move to **In Progress** (no planning)
- **In Progress** → agent finishes (merge, PR, etc.) → issue **stays in In Progress**; the user manually moves it to **Done** when appropriate

Auto-move rules:

- On workspace `claimed`: if the issue is in **To Do** and planning is skipped, move to **In Progress**; if planning is enabled, do not move on claim.
- On `approvePlan`: move to the next non-terminal column (typically **To Do** → **In Progress**); never into **Done**.
- On workspace `completed` or `merged`: do **not** auto-move into **Done** (terminal); the user moves the card to **Done** manually.
- On dismiss review feedback (`completed` workspace): same — no automatic move into **Done**.
- The target column is the next column by fixed position order.
- If there is no next column, the issue stays put.
- Position in the target column is calculated as max existing position + 1 (appended to end).

Auto-dispatch rules:

- An issue is only auto-dispatched once per entry into **To Do** (no duplicate workspaces while one is running).
- If the issue already has a running workspace, it is not dispatched again.
- If the project has no default agent configuration or no configured repositories, auto-dispatch is skipped with a warning.

### 10.3 Retry, Continuation, and Backoff

#### Manual Retry

On agent failure or timeout:

- The workspace is preserved (not cleaned up).
- The run attempt is recorded with its error.
- The user can manually retry from the UI (creates a new run attempt in the same workspace).
- The retry prompt includes continuation context: what happened in the previous attempt, the error message, and any partial progress.

On agent success:

- The workspace status is set to `completed`.
- The user reviews the diff and decides whether to merge and move the issue to "Done".

#### Auto-Retry

When auto-retry is enabled for an agent configuration:

- `maxRetries` (integer, default: `3`) — Maximum number of automatic retry attempts.
- `retryBackoffMs` (integer, default: `10000`) — Base backoff delay in ms.
- `maxRetryBackoffMs` (integer, default: `300000`) — Maximum backoff cap (5 minutes).

Backoff formula:

- Normal continuation retries (agent exited 0 but issue still needs work) use a short fixed delay of `1000 ms`.
- Failure-driven retries use exponential backoff: `delay = min(retryBackoffMs * 2^(attempt - 1), maxRetryBackoffMs)`.

Retry handling behavior:

1. On agent failure, check if `attempt < maxRetries`.
2. If retries remain, schedule a new run attempt after the computed backoff delay.
3. Before dispatching the retry, re-check issue status — if the issue has been moved to **Done**, abandon the retry.
4. If no concurrency slots are available when the retry fires, requeue with error `no available slots` and try again after another backoff period.
5. If retries are exhausted, mark workspace as `failed` and leave for user review.

Retry entry (stored in Convex):

- `workspaceId`
- `attemptNumber` (1-based)
- `dueAt` (Unix timestamp ms)
- `error` (string — reason for the retry)
- `status` (`pending`, `dispatched`, `abandoned`)

### 10.4 Cancellation

The user can cancel a running agent from the UI:

1. UI calls a Convex mutation that marks the workspace for cancellation.
2. Worker detects the cancellation flag and sends SIGTERM to the agent subprocess.
3. Wait up to 5 seconds for graceful shutdown.
4. If still running, send SIGKILL.
5. Mark the run attempt as `cancelled`.
6. Workspace is preserved for inspection.

Phases without a running agent subprocess (including `pr_open`, while the worker only polls for merge) still use the same cancel mutation. The worker transitions the workspace to `cancelled` without sending signals to a child process. Closing the pull request on the forge is manual; cancellation does not call the forge API.

## 11. Development Lifecycle

A workspace progresses through a defined lifecycle from branch creation to merge. Each stage is tracked on the workspace record and visible in the UI.

### 11.1 Lifecycle Stages

```
┌──────────┐   ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌───────────┐
│ Creating │──▶│ Planning │──▶│ Awaiting  │──▶│  Coding  │──▶│ Reviewing │──▶│ Testing  │──▶│ Completed │
└──────────┘   └──────────┘   │ Feedback  │   └──────────┘   └───────────┘   └──────────┘   └───────────┘
                    ▲         └───────────┘        │               │              │               │
                    │              │                ▼               ▼              ▼          ┌────┴──────────────┐
                    │         ┌────┴────┐      ┌──────────┐   ┌──────────┐  ┌──────────┐    │  Manual actions   │
                    │         │ Approve │      │  Failed  │   │ Changes  │  │  Failed  │    │  from the UI:     │
                    │         │  Plan   │      └──────────┘   │ Requested│  └──────────┘    ├───────────────────┤
                    │         └─────────┘                     └──────────┘                  │ • Create PR       │
                    │         │ Re-plan │                                                   │ • Local Merge     │
                    │         └────┬────┘                                                   │ • Rebase          │
                    └─────────────┘                                                        │ • New Experiment  │
                                                                                           └───────────────────┘
```

1. **Creating** — Git worktrees are being created for each project repo. Setup hooks run. If this is a new experiment (experimentNumber > 1), branches are reset to base.
2. **Planning** (optional, per-project via `skipPlanning`) — A planning agent runs in plan mode (read-only). It explores the codebase, asks clarifying questions via MCP (`ask_question`), and submits an implementation plan (`submit_plan`). The planning agent cannot modify files.
3. **Awaiting Feedback** — The planning agent has finished. The user reviews the plan, answers any pending questions, edits the plan if needed, and either approves it or requests re-planning. Approval transitions the workspace back to `creating` with `planApproved=true`.
4. **Coding** — The coding agent is executing with the approved plan included in its prompt. It works on the issue, makes changes, and commits. The agent can check for user feedback via MCP (`get_feedback`).
5. **Reviewing** — A fresh agent run reviews the diff with clean context. The review agent checks for bugs, style issues, missing tests, and potential problems. If it requests changes, the coding agent is re-dispatched with the review feedback (up to maxReviewCycles). Tests are not run during review fix cycles.
6. **Testing** — After the review agent approves (or when review is skipped), the worker runs the project's configured test command in the worktree. If tests fail, the worker resumes the coding agent once with test output (and exposes `get_test_results` via MCP); if tests still fail after that, the workspace moves to `test_failed` for user review. Test failures after review do not trigger another review round.
7. **Completed** — Work is done. The user can now take manual actions from the UI:
   - **Create PR** — Pushes the branch and creates a pull request via the forge adapter (`creating_pr` → `pr_open`).
   - **Local Merge** — Squash-merges the branch into the base branch (`git merge --squash` then a single commit; `merging` → `merged`). No merge commit and no forge/PR flow required. Afterward the worker attempts `git push origin <base>` (best-effort; failures are logged only). Periodically it fast-forwards the local base from `origin` when possible so upstream changes are picked up.
   - **Rebase** — Rebases the branch onto the latest base branch (`rebasing` → `completed`). Available when the branch is behind main.
   - **New Experiment** — Discards all changes, resets branches, increments experiment number, and re-enters coding with the same plan. Allows iterating on implementation without re-planning.

Failed states can occur at any stage and are retried according to the retry/backoff policy.

### 11.2 Workspace Status Values

The workspace `status` field is updated to reflect the current lifecycle stage:

- `creating` — Worktrees being set up.
- `planning` — Planning agent is exploring codebase and creating implementation plan.
- `awaiting_feedback` — Planning complete, awaiting user review/approval of plan.
- `coding` — Agent is working on the implementation (with approved plan if planning was enabled).
- `testing` — Running test suite.
- `test_failed` — Tests failed. Awaiting retry or user intervention.
- `reviewing` — Review agent is analyzing changes.
- `changes_requested` — Review agent found issues. Coding agent will be re-dispatched to address them.
- `completed` — Work finished. User can now Create PR, Merge locally, Rebase, or start a New Experiment from the UI.
- `creating_pr` — Pushing branch and creating pull request via forge adapter.
- `pr_open` — Pull request created, awaiting merge.
- `merging` — Performing local merge into base branch.
- `merged` — Branch merged (locally or via PR). Issue complete.
- `rebasing` — Rebasing branch onto latest base branch.
- `conflict` — Rebase conflicts detected. Agent dispatched to resolve.
- `failed` — Unrecoverable failure.
- `cancelled` — User cancelled.

### 11.3 Coding Stage

The coding agent receives a prompt that includes:

- The issue title, description, and acceptance criteria.
- Instructions to self-review changes before finishing.
- Instructions to run tests if a test command is configured.
- Instructions to commit changes with meaningful commit messages referencing the issue simple ID.
- **Default workflow only** (when no custom `workflow` template): instructions to create new Backlog issues via MCP `create_issue` for out-of-scope follow-ups, with a reference to the current issue, instead of leaving informal notes in comments.

The agent's prompt is constructed so that it treats its own work as a complete unit — it should not exit until it believes the work is done and tests pass.

If the agent exits with code 0, the workspace advances to the Reviewing stage (unless review is skipped on the project).
If the agent exits with non-zero, the workspace enters `failed` status and follows the retry policy.

### 11.4 Review Stage

After the coding agent exits successfully, a fresh agent run reviews the changes:

1. The worker creates a new run attempt on the same workspace with `type: review`.
2. The review agent receives a prompt containing:
   - The git diff of all changes (branch vs base).
   - The original issue title and description.
   - Instructions to check for: bugs, logic errors, missing edge cases, code style issues, security concerns, missing or inadequate tests, and documentation gaps.
3. The review agent does NOT receive the coding agent's conversation history — it gets fresh context to simulate an independent reviewer.
4. The review agent produces a structured result:
   - **Approve** — Changes look good. The worker proceeds to the Testing stage (or skips it if tests are disabled), then toward completion and manual follow-up actions (rebase, PR, merge) as configured.
   - **Request Changes** — Agent found issues. It outputs a list of specific changes needed.
   - **Concern** — Agent flags potential problems but doesn't block (informational).

If the review agent requests changes:

1. The workspace status is set to `changes_requested`.
2. A new coding agent run is dispatched with the review feedback as context.
3. After the coding agent addresses the feedback, the workspace goes through Reviewing again (tests run only after a review round produces **Approve**).
4. A maximum of `maxReviewCycles` (default: `3`) review iterations are allowed before the workspace stops and waits for user intervention.

If no review agent config is set for the project, the review stage is skipped.

### 11.5 Testing Stage

After review approval (or when the review stage is skipped), the worker runs tests:

1. Execute the project's configured `testCommand` in the worktree (e.g. `bun test`, `npm test`).
2. Capture test output and store it as agent logs in Convex.
3. If tests pass (exit code 0), the workspace advances toward completion and post-completion actions (rebase, PR, merge) as configured.
4. If tests fail:
   a. Dispatch the coding agent once more with the test failure output in the prompt (truncated to the same limit as other script prompts). The agent may also call the MCP tool `get_test_results` to read the latest test run logs from Convex. The workspace returns to `coding` status, then tests run again without another review round.
   b. If tests still fail after that single test-fix attempt, set status to `test_failed` for user review.

Test configuration (per repository):

- `testCommand` (string or null) — Shell command to run tests. If null, the testing stage is skipped.
- `testTimeoutMs` (number) — Timeout for the test command. Default: `300000` (5 minutes).

If no `testCommand` is configured, the workspace skips the Testing stage after review (or after coding when review is skipped).

### 11.6 Rebase Stage

Before opening a PR, the workspace branch must be up to date with the base branch:

1. The worker runs `git fetch origin` in the worktree.
2. The worker runs `git rebase origin/<base-branch>` in the worktree.
3. If the rebase succeeds cleanly, advance to PR Open.
4. If the rebase has conflicts:
   a. The worker aborts the rebase (`git rebase --abort`).
   b. The workspace status is set to `conflict`.
   c. A coding agent is dispatched with the conflict details (which files conflict, the diff of the conflicting changes) and instructions to resolve them.
   d. After the agent resolves conflicts and commits, the workspace continues the post-coding pipeline (Reviewing, then Testing after approval) to verify the resolution.

### 11.7 PR Open Stage

The worker creates a pull request via the forge adapter:

1. Push the workspace branch to the remote: `git push -u origin <branch-name>`.
2. Create the PR using the forge adapter (see Section 13).
3. Store the PR URL on the workspace record.
4. The workspace status is set to `pr_open`.

What happens next depends on the project's `mergePolicy`:

- **`auto_merge`** — The worker monitors the PR status. Once CI passes and the PR is mergeable, it merges automatically (using `gh pr merge --auto` or equivalent). After merge, the workspace advances to `merged`.
- **`manual_merge`** — The workspace stays in `pr_open`. The user reviews the PR and merges manually. The worker periodically checks PR status and advances to `merged` when it detects the PR was merged.
- **`local_merge`** — Skips PR creation entirely. After rebasing onto the base branch, the worker squash-merges the feature branch into the base with `git merge --squash` and one commit (subjects from the feature commits become the squashed message). After merge, the feature branch is deleted and the workspace advances to `merged`. Enables fully offline operation without any forge tooling.

### 11.8 Merged Stage

After the PR is merged:

1. The issue **stays in In Progress**; the user moves it to **Done** when appropriate (no auto-move into the terminal column on merge).
2. The workspace status is set to `merged`.
3. Cleanup is scheduled: worktrees are removed after a configurable delay (`cleanupDelayMs`, default: `3600000` / 1 hour) to allow the user to inspect the final state if needed.

### 11.9 Project workflow configuration

Configure on the **project** (Settings → Workflow):

- `mergePolicy` (string or null) — One of: `auto_merge`, `manual_merge`, `local_merge`, or null. Controls merge behavior after review and tests.
- `skipReview` (boolean) — Whether to skip the independent review stage.
- `skipTests` (boolean) — Whether to skip the testing stage.
- `skipPlanning` (boolean) — When `false`, a planning agent runs before coding to create an implementation plan that must be approved by the user.
- `autoPlanReview` (boolean) — Optional automated plan review when planning is enabled.
- `maxConcurrent` (number, optional) — Cap concurrent running workspaces for this project.

Example combinations:

- **Full PR automation**: `mergePolicy: "auto_merge"` — Worker can merge the PR when mergeable.
- **Manual merge**: `mergePolicy: "manual_merge"` — User merges the PR in the forge UI; worker detects merge completion.
- **Local merge**: `mergePolicy: "local_merge"` — Squash-merge into the base branch in the worktree without forge PRs.
- **Skip review for small changes**: `skipReview: true` with an appropriate merge policy.

### 11.10 Planning Agent Configuration

Projects can configure a separate agent configuration for planning runs:

- `planningAgentConfigId` (Id<"agentConfigs"> or null) — Agent config to use for planning runs. If null, the same config as the default agent is used.

The planning agent can be a different model than the coding agent (e.g. use a strong reasoning model for planning and a faster model for coding).

### 11.11 Review Agent Configuration

Projects can configure a separate agent configuration for review runs:

- `reviewAgentConfigId` (Id<"agentConfigs"> or null) — Agent config to use for review runs. If null, the same config as the coding agent is used.
- `maxReviewCycles` (number) — Maximum code → review → fix iterations before stopping. Default: `3`.

The review agent can be a different model than the coding agent (e.g. use a cheaper/faster model for review, or a different model for a "second opinion" effect).

## 12. Web UI Specification

### 12.1 Views

1. **Board View** — Kanban board with columns. Drag-and-drop issue cards between columns. Filter by workspace status, search text. Sort by created date, updated date, or manual order. All data via Convex `useQuery` — instantly reactive.

2. **Issue Detail Modal** — Opens as a centered modal (Jira-style) when an issue card is clicked. Full-screen on mobile, centered dialog on tablet/desktop. Shows full issue content, metadata, comments, linked workspaces with their status and lifecycle stage, and attachments. Supports editing all fields inline.

3. **Workspace View** — Shows workspace details: agent configuration, lifecycle stage, run attempts, and real-time agent log output via Convex subscription. Includes a code diff viewer showing all changes made by the agent. Shows review results and test output. Has a Plan tab showing the implementation plan (editable), agent questions with answer forms, and a feedback message queue for bidirectional agent-user communication. When a question includes suggested answers, choosing a suggestion prefills the answer textarea so the user can edit or extend it before submitting with **Answer** (suggestions do not submit on their own).

4. **List View** — Tabular view of all issues including hidden columns. Useful for bulk review.

5. **Settings** — Project configuration (columns, repositories, agent configs, review config), global settings (worktree root, concurrency).

### 12.2 URL Routing

All UI state is encoded in the URL hash so that refreshing the page restores the exact view. Format: `#/<project-slug>/<view>/<issueSimpleId>/ws/<workspaceId>`.

- `#/my-project/board` — Board view
- `#/my-project/board/PROJ-42` — Board view with issue PROJ-42 detail modal open
- `#/my-project/board/PROJ-42/ws/<workspaceId>` — Board with issue detail and workspace modal open
- `#/my-project/list/PROJ-42` — List view with issue detail open
- `#/my-project/settings` — Settings view

Browser back/forward navigates through modal open/close history. Every page, modal, and panel must have a unique URL.

### 12.3 Real-Time Updates

All data flows through Convex subscriptions (`useQuery`). When any data changes (issue moved, agent writes a log line, workspace status changes, comment added via MCP), every connected UI client updates automatically. No WebSocket protocol to maintain — Convex handles this.

### 12.4 Code Diff Viewer

The workspace view includes a live unified diff viewer (plain HTML/CSS, no editor bundle):

- **Live updates:** During the coding stage, the worker polls `git diff` every 5 seconds and writes `diffOutput` on the workspace document. The UI receives changes in real-time via Convex subscriptions — no manual refresh needed. (There is no separate file-tree snapshot or on-demand file read path; the diff string is the source of truth for changed content.)
- **Unified diff:** Renders the full `git diff` output in one scrollable view. Each file is a section with path and status badge (A = added, M = modified, D = deleted). Hunk headers (`@@`) separate change blocks; added lines use a green tint, removed lines a red tint, with old/new line numbers in gutters.
- **Large diffs:** The UI counts flat rows (same rules as the flattened list: file headers, hunk headers, and lines) without building the full list; only above 500 rows does it allocate the flat list and use `@tanstack/react-virtual` for the visible window. Smaller diffs render normally with no virtualization overhead. Scroll resets to the top only when a fingerprint of the diff changes (`length` plus the first 100 characters), not on every substring edit.
- **Binary files:** When the diff indicates a binary change, a short note is shown instead of line-by-line content.

### 12.5 Agent Log Stream

The workspace view includes a log panel:

- Subscribes to `api.agentLogs.list` for the active run attempt. New log entries appear instantly.
- For Claude Code with `stream-json` output, renders structured events (assistant messages, tool calls, MCP tool calls, errors) with appropriate formatting.
- For other agents, displays raw output.
- Completed runs show the full log history from Convex.

## 13. Forge Integration

### 13.1 GitHub Adapter (Default)

See `IForgeAdapter` in Section 6.2.

Creates pull requests using the `gh` CLI:

- For each worktree in the workspace that has commits ahead of its base branch, creates a separate PR.
- Command per repo: `gh pr create --title <title> --body <body> --base <base-branch> --head <workspace-branch>`
- Title defaults to the issue title (with repo name suffix for multi-repo workspaces).
- Body defaults to the issue description. Multi-repo PRs cross-reference each other.
- Requires `gh` to be installed and authenticated.

### 13.2 Forge Adapter Interface

See `IForgeAdapter` in Section 6.2.

Required adapters:

- **GitHub** (`github`) — Uses `gh` CLI. Default adapter. See Section 13.1.
- **GitLab** (`gitlab`) — Uses `glab` CLI. Same interface, different command.
- **Azure DevOps** (`azure`) — Uses `az repos` CLI with the `azure-devops` extension.

## 14. MCP Server (Agent ↔ Board Integration)

Yes Kanban exposes an MCP (Model Context Protocol) server that allows coding agents to interact with the board during execution. This enables agents to report blockers, add comments, and manage issues without human intervention.

### 14.1 MCP Server Lifecycle

The MCP server is started by the worker when it launches an agent:

1. Before starting the agent subprocess, the worker starts a local MCP server bound to a Unix socket or localhost port.
2. The agent is launched with the MCP server connection details passed via environment variables or CLI flags (e.g. `--mcp-config` for Claude Code).
3. The MCP server has access to the Convex client, so all tool calls result in real Convex mutations — changes are immediately visible in the UI.
4. When the agent exits, the MCP server is shut down.

Each workspace gets its own MCP server instance. The server is scoped to the workspace's project by default, but can access other projects if needed.

### 14.2 MCP Tools

The MCP server exposes the following tools to the agent. Moving issues between columns is not available via MCP (users move cards on the board); the Convex `issues.move` mutation still rejects `actor: agent` when the target is a terminal column such as Done.

#### Issue Management

- **`create_issue`** — Create a new issue in the project.
  - Parameters: `title` (required), `description`, `status`, `tags`.
  - Returns: `{ issueId, simpleId }`.

- **`update_issue`** — Update an existing issue.
  - Parameters: `issueId` or `simpleId` (required), plus any fields to update: `title`, `description`, `tags`, `autoMerge`. (Column/status changes are not supported here; use the board UI, which calls `issues.move`.)
  - Returns: `{ updated: true }`.

- **`delete_issue`** — Delete an issue.
  - Parameters: `issueId` or `simpleId` (required).
  - Returns: `{ deleted: true }`.

- **`get_issue`** — Read an issue's details.
  - Parameters: `issueId` or `simpleId` (required).
  - Returns: Full issue object including description, status, tags, and workspace count.

- **`list_issues`** — List issues in the project with optional filters.
  - Parameters: `status`, `tags`, `search`.
  - Returns: Array of issue objects.

#### Comments

- **`add_comment`** — Add a comment to an issue.
  - Parameters: `issueId` or `simpleId` (required), `body` (required, Markdown).
  - Returns: `{ commentId }`.

- **`list_comments`** — List comments on an issue.
  - Parameters: `issueId` or `simpleId` (required).
  - Returns: Array of comment objects.

#### Relationships

- **`add_blocker`** — Mark an issue as blocked by another issue.
  - Parameters: `issueId` (required), `blockedByIssueId` (required).
  - Returns: `{ updated: true }`.

- **`remove_blocker`** — Remove a blocker relationship.
  - Parameters: `issueId` (required), `blockedByIssueId` (required).
  - Returns: `{ updated: true }`.

#### Board Context

- **`get_current_issue`** — Get the issue associated with the current workspace (no parameters needed, scoped automatically).
  - Returns: Full issue object, or null for standalone workspaces.

- **`get_project_columns`** — List the project's board columns with their configuration.
  - Returns: Array of column objects.

- **`get_workspace_info`** — Get details about the current workspace (repos, branches, status).
  - Returns: Workspace object with worktree entries.

#### Planning & Feedback

- **`ask_question`** — Ask the user a clarifying question. Used during planning to gather requirements.
  - Parameters: `question` (required, string).
  - Returns: `{ questionId, status: "pending" }`.
  - Questions appear in the workspace's Plan tab for the user to answer.

- **`submit_plan`** — Submit an implementation plan for user review.
  - Parameters: `plan` (required, Markdown string).
  - Returns: `{ submitted: true }`.
  - The plan is stored on the workspace and shown in the Plan tab.

- **`get_plan`** — Get the current implementation plan and its approval status.
  - Returns: `{ plan, approved }`.

- **`get_feedback`** — Check for pending feedback messages from the user. Returns and marks as delivered any unread messages.
  - Returns: `{ messages: [{ id, body, author, createdAt }] }`.

### 14.3 MCP Server Configuration

The MCP server is configured per-agent via the agent config:

- `mcpEnabled` (boolean) — Whether to start an MCP server for this agent. Default: `true`.
- `mcpTools` (list of strings or null) — Allowlist of tool names. If null, all tools are available. Use this to restrict agents to a subset of operations (e.g. `["create_issue", "add_comment", "get_current_issue"]`).

The worker passes the MCP connection to the agent. For Claude Code, this is done via:

```
claude --mcp-config <path-to-mcp-config.json> ...
```

The worker writes a temporary JSON file that defines only the `yes-kanban` MCP server (stdio bridge to the local TCP server). Claude Code merges this with the agent’s normal MCP configuration on the machine; it is not passed `--strict-mcp-config`, so other MCP servers the user configured in their standard Claude Code settings remain available.

```json
{
  "mcpServers": {
    "yes-kanban": {
      "command": "bun",
      "args": ["run", "<path-to-stdio-bridge-script>"]
    }
  }
}
```

For agents that don't support MCP, the tools can be exposed as a CLI that the agent can shell out to, wrapping the same Convex mutations.

### 14.4 Comment Model

Comments are a new entity required for the MCP `add_comment` / `list_comments` tools.

Fields:

- `_id` (Id<"comments">)
- `issueId` (Id<"issues">)
- `body` (string) — Markdown content.
- `author` (string) — Either `user` or the agent config name (e.g. `claude-code-sonnet`).
- `runAttemptId` (Id<"runAttempts"> or null) — If the comment was made by an agent during a run, link to the run attempt.
- `createdAt` (number)

Convex schema addition:

```typescript
comments: defineTable({
  issueId: v.id("issues"),
  body: v.string(),
  author: v.string(),
  runAttemptId: v.optional(v.id("runAttempts")),
  createdAt: v.number(),
})
  .index("by_issue", ["issueId", "createdAt"])
  .index("by_run_attempt", ["runAttemptId"]),
```

### 14.5 MCP Tool Scoping and Safety

- The MCP server is scoped to the workspace's project by default. Cross-project operations require explicit `projectId` parameters.
- All mutations go through the same Convex mutation layer as the UI, so validation and constraints are enforced consistently.
- Tool calls are logged as agent log entries (with `structured.type: "mcp_tool_call"`) for auditability.
- If `mcpTools` is configured, any tool call not on the allowlist returns an error without executing.
- Rate limiting: the MCP server limits tool calls to 60 per minute per workspace to prevent runaway agents from flooding the board.

## 15. Configuration

### 15.1 Worker Configuration

The worker reads configuration from environment variables and/or a config file:

```yaml
# worker-config.yaml
convex:
  url: "http://localhost:3210"       # Self-hosted Convex URL

worker:
  max_concurrent_agents: 3
  stall_timeout_ms: 300000           # 5 min
  default_agent_timeout_ms: 3600000  # 1 hour
  worktree_root: "~/.yes-kanban/worktrees"
  poll_interval_ms: 3000
```

### 15.2 Convex Configuration

Convex self-hosted runs as a Docker container. Configuration:

```yaml
# docker-compose.yaml (example)
services:
  convex:
    image: ghcr.io/get-convex/convex-backend:latest
    ports:
      - "3210:3210"
    volumes:
      - convex-data:/convex/data
```

### 15.3 Worker Separation

When running the worker on a separate machine:

- The worker connects to the Convex instance URL (must be network-accessible).
- The worker must have access to the git repositories on its local filesystem.
- Multiple workers can connect to the same Convex instance (for scaling, each claims work independently).
- Remote workers use the same poll-and-claim loop as co-located workers — no separate protocol.
- The Convex instance should be secured with TLS and authentication when exposed on a network.

## 16. Failure Model and Recovery Strategy

### 16.1 Failure Classes

1. **Convex/Storage Failures**
   - Database unavailable or unreachable.
   - Mutation fails (conflict, validation error).
   - File storage upload/download failure.

2. **Git/Workspace Failures**
   - Worktree creation fails (branch already exists, repo not found, disk full).
   - Workspace directory permission errors.
   - Hook script timeout or failure.
   - Invalid workspace path (outside workspace root).

3. **Agent Session Failures**
   - Agent CLI not found or not executable.
   - Startup failure (non-zero exit before any output).
   - Turn failed (non-zero exit during execution).
   - Turn timeout (exceeded `timeoutMs`).
   - Stalled session (no output for `stallTimeoutMs`).
   - Agent requests user input (not supported in autonomous mode — hard fail).

4. **Forge Failures**
   - CLI tool (`gh`) not installed.
   - CLI tool not authenticated.
   - PR creation fails (network, permissions, branch not pushed).
   - PR status check fails.

5. **Observability Failures**
   - Log write to Convex fails (batch dropped).
   - UI subscription disconnected.

### 16.2 Recovery Behavior

- **Convex failures**: Worker retries connection with exponential backoff. UI shows connection error banner. In-flight agent output is buffered locally and flushed when connection recovers.

- **Workspace failures**: Workspace status set to `failed` with error message in Convex. Partially created worktrees are cleaned up. User can retry from UI.

- **Agent failures**: Run attempt recorded with error and exit code. Workspace preserved for inspection. If auto-retry is enabled, schedule retry with backoff. Otherwise, wait for user intervention.

- **Forge failures**: Error surfaced in UI with actionable message (e.g. "Install gh CLI" or "Run gh auth login"). Does not affect workspace or issue status.

- **Observability failures**: Dropped log lines are lost. Does not affect agent execution or orchestration correctness.

### 16.3 Recovery on Worker Restart

All state lives in Convex. A worker restart loses no data.

After worker restart:

1. Query Convex for workspaces with status `running`.
2. For each, check if a corresponding local process exists (by PID or process lookup).
3. If no live process exists, mark the workspace as `failed` with error `Worker restarted — agent process orphaned`.
4. Resume polling for new work.

No retry timers are restored from the prior worker process. Pending auto-retries stored in Convex are picked up on the next poll cycle.

### 16.4 User Intervention Points

The user can control behavior by:

- Moving issues between columns (triggers auto-dispatch or cancels running agents if moved to terminal column).
- Manually retrying failed workspaces from the UI.
- Cancelling running agents from the UI.
- Editing agent configurations (changes apply to new workspaces only, not running ones).
- Deleting workspaces to clean up worktrees.

## 17. Tech Stack

- **Runtime**: Bun (worker), Node.js (Convex functions)
- **Language**: TypeScript throughout
- **Backend**: Convex (self-hosted, Docker)
- **Frontend**: React with Convex React client
- **Storage**: Convex document database + Convex file storage (attachments)
- **Real-time**: Convex reactive subscriptions (no custom WebSocket layer)
- **Git**: Git CLI via subprocess (in worker)
- **Agent execution**: CLI subprocess with stdout/stderr capture (in worker)

## 18. Parallel Development Plan

The interface contracts in Section 6 enable independent workstreams:

| Workstream | Depends On | Implements |
| --- | --- | --- |
| **Convex Schema + Functions** | Schema definition (Section 5) | All `api.*` functions from Section 6.1 |
| **Web UI — Board** | `api.projects.*`, `api.columns.*`, `api.issues.*` | Board view, drag-and-drop, filters |
| **Web UI — Workspace/Logs** | `api.workspaces.*`, `api.agentLogs.*`, `api.runAttempts.*` | Workspace view, log stream, diff viewer |
| **Worker — Worktree Manager** | `IWorktreeManager` interface | Git worktree create/remove/diff |
| **Worker — Agent Executor** | `IAgentAdapter`, `IAgentExecutor` interfaces | Subprocess management, output parsing |
| **Worker — Main Loop** | All worker interfaces + Convex functions | Dispatch polling, task execution flow |
| **Worker — Forge Adapter** | `IForgeAdapter` interface | GitHub PR creation via `gh` |

Each workstream can be developed and tested against mocked interfaces before integration.

## 19. Security and Operational Safety

### 19.1 Trust Boundary

Yes Kanban is designed for a single developer running on their own machine. The trust boundary is the developer themselves.

Operational safety requirements:

- The developer explicitly opts into autonomous agent execution via `--dangerously-skip-permissions` or equivalent flags.
- This is a high-trust configuration. The agent can execute arbitrary commands, modify files, and access the network with the same permissions as the worker process.

### 19.2 Filesystem Safety

Mandatory:

- Workspace paths must remain under the configured `worktreeRoot`.
- Agent `cwd` must be the workspace path for the current run.
- Branch and directory names must use sanitized identifiers (see Section 8.7).
- Reject any path that escapes the workspace root via `..` or symlinks.

Recommended hardening:

- Run the worker under a dedicated OS user with limited permissions.
- Restrict workspace root permissions to that user.
- Mount workspace root on a dedicated volume if available.

### 19.3 Secret Handling

- Agent configurations may contain API keys in `env` fields. These are stored in Convex.
- Do not log environment variable values that contain secrets.
- The UI should mask `env` values in agent configuration views.
- Convex self-hosted runs locally — secrets do not leave the machine.

### 19.4 Hook Script Safety

Workspace hooks (`setupScript`, `beforeRunScript`, `afterRunScript`, `cleanupScript`) are arbitrary shell commands configured by the developer.

Implications:

- Hooks are fully trusted configuration (the developer wrote them).
- Hooks run inside the workspace directory.
- Hook stdout/stderr should be captured but truncated in logs (max 10KB).
- Hook timeouts are mandatory to avoid hanging the worker.
- A hook should never be able to affect workspaces other than its own.

### 19.5 Network Safety

- Convex binds to localhost by default. If exposed on a network, use a reverse proxy with authentication.
- The worker should also bind locally. Remote worker mode should use TLS and authentication.

### 19.6 Hardening Guidance

Running coding agents against repositories and issue content can be dangerous. A permissive deployment can lead to data leaks, destructive mutations, or machine compromise if the agent executes harmful commands.

Possible hardening measures:

- Tightening agent permission settings instead of running with `--dangerously-skip-permissions`.
- Adding external isolation layers (containers, VMs, network restrictions).
- Limiting which issues are eligible for auto-dispatch via tags or column configuration.
- Reducing the set of tools, credentials, and network destinations available to the agent.

## 20. Observability and Logging

### 20.1 Logging Conventions

All worker logs should include structured context fields:

For issue-related logs:
- `issueId`
- `simpleId`

For workspace-related logs:
- `workspaceId`

For agent session logs:
- `runAttemptId`
- `attemptNumber`

Message formatting:

- Use stable `key=value` phrasing.
- Include action outcome (`completed`, `failed`, `retrying`, `stalled`, `cancelled`).
- Include concise failure reason when present.
- Avoid logging large raw payloads (truncate at 1KB unless debug mode).

### 20.2 Log Storage

Agent output (stdout/stderr) is stored in Convex as `agentLogs` documents. This provides:

- Real-time streaming to the UI via subscriptions.
- Historical log access for completed runs.
- Searchable log content.

Worker operational logs (startup, dispatch, errors) are emitted to stderr as structured JSON. These can be redirected to a file or log aggregator.

### 20.3 Metrics

The worker tracks and reports to Convex:

- `runningCount` — Number of currently executing agents.
- `queuedCount` — Number of workspaces waiting for a slot.
- `completedCount` — Total completed run attempts.
- `failedCount` — Total failed run attempts.
- `totalTokenUsage` — Aggregate token usage across all runs.
- `totalRuntimeSeconds` — Aggregate agent execution time.

These are available via `api.dispatch.status` for the UI dashboard.

### 20.4 Health Indicators

The UI should show:

- Worker connection status (connected/disconnected to Convex).
- Number of running/queued agents.
- Last successful dispatch time.
- Any recent errors (last 10, with timestamps).

## 21. Reference Algorithms

### 21.1 Worker Startup

```text
function worker_startup(config):
  convex = connect_to_convex(config.convexUrl)
  validate_config(config)

  # Recover from previous crash
  orphaned = convex.query(api.workspaces.listByStatus, { status: "running" })
  for workspace in orphaned:
    if not process_is_alive(workspace):
      convex.mutation(api.workspaces.updateStatus, {
        id: workspace._id,
        status: "failed",
        completedAt: now()
      })
      convex.mutation(api.runAttempts.complete, {
        id: active_attempt(workspace),
        status: "failed",
        error: "Worker restarted — agent process orphaned"
      })

  log("Worker started, recovered ${len(orphaned)} orphaned workspaces")
  start_poll_loop(convex, config)
```

### 21.2 Worker Poll Loop

```text
function poll_loop(convex, config):
  slots = Semaphore(config.maxConcurrentAgents)

  while true:
    if slots.available > 0:
      task = convex.query(api.dispatch.next)
      if task is not null:
        # Check blocker eligibility
        if has_unresolved_blockers(convex, task.issue):
          skip  # Will be picked up when blockers clear
          continue

        claimed = convex.mutation(api.dispatch.claim, { workspaceId: task.workspaceId })
        if claimed:
          slots.acquire()
          spawn(async () ->
            try:
              execute_task(convex, config, task)
            finally:
              slots.release()
          )

    # Process pending auto-retries
    pending_retries = convex.query(api.retries.pending)
    for retry in pending_retries:
      if retry.dueAt <= now() and slots.available > 0:
        dispatch_retry(convex, config, retry, slots)

    sleep(config.pollIntervalMs)
```

### 21.3 Task Execution

```text
function execute_task(convex, config, task):
  workspace = task.workspace
  repos = task.repos
  agentConfig = task.agentConfig
  issue = task.issue

  # 1. Create worktrees
  try:
    worktrees, agentCwd = worktreeManager.createWorktrees({
      workspaceId: workspace._id,
      simpleId: issue.simpleId,
      repos: repos
    })
    convex.mutation(api.workspaces.updateStatus, {
      id: workspace._id, status: "ready", worktrees, agentCwd
    })
  catch error:
    convex.mutation(api.workspaces.updateStatus, {
      id: workspace._id, status: "failed", completedAt: now()
    })
    return

  # 2. Run before_run hooks
  for repo in repos:
    if repo.beforeRunScript:
      result = exec_with_timeout(repo.beforeRunScript, {
        cwd: find_worktree(worktrees, repo._id),
        timeout: repo.scriptTimeoutMs
      })
      if result.failed:
        convex.mutation(api.workspaces.updateStatus, {
          id: workspace._id, status: "failed", completedAt: now()
        })
        return

  # 3. Build prompt and create run attempt
  prompt = build_prompt(issue, task.additionalPrompt, worktrees)
  runAttemptId = convex.mutation(api.runAttempts.create, {
    workspaceId: workspace._id, prompt
  })
  convex.mutation(api.workspaces.updateStatus, {
    id: workspace._id, status: "running"
  })

  # 4. Launch agent
  adapter = get_adapter(agentConfig.agentType)
  cmd = adapter.buildCommand({ config: agentConfig, prompt, cwd: agentCwd })

  abortController = new AbortController()
  logBuffer = []
  flushLogs = debounce(() ->
    if logBuffer.length > 0:
      convex.mutation(api.agentLogs.appendBatch, { entries: logBuffer.splice(0) })
  , 100)

  # Check for cancellation
  cancellationWatcher = poll_every(3000, () ->
    ws = convex.query(api.workspaces.get, { id: workspace._id })
    if ws.status == "cancelled":
      abortController.abort()
  )

  result = executor.execute({
    command: cmd.command, args: cmd.args, env: cmd.env,
    cwd: agentCwd, timeoutMs: agentConfig.timeoutMs,
    stallTimeoutMs: config.stallTimeoutMs,
    onLine: (stream, line) ->
      structured = adapter.parseLine(line)
      logBuffer.push({
        runAttemptId, workspaceId: workspace._id,
        stream, line, structured, timestamp: now()
      })
      flushLogs()
    signal: abortController.signal
  })

  cancellationWatcher.stop()
  flushLogs.flush()

  # 5. Run after_run hooks (best-effort)
  for repo in repos:
    if repo.afterRunScript:
      try:
        exec_with_timeout(repo.afterRunScript, {
          cwd: find_worktree(worktrees, repo._id),
          timeout: repo.scriptTimeoutMs
        })
      catch: log_warning("after_run hook failed")

  # 6. Record result
  status = if result.exitCode == 0: "succeeded"
    else if result.timedOut: "timed_out"
    else if result.stalled: "failed"
    else: "failed"

  convex.mutation(api.runAttempts.complete, {
    id: runAttemptId, status,
    exitCode: result.exitCode,
    error: describe_error(result),
    tokenUsage: adapter.extractTokenUsage(collectedEvents)
  })

  workspaceStatus = if status == "succeeded": "completed" else: "failed"
  convex.mutation(api.workspaces.updateStatus, {
    id: workspace._id, status: workspaceStatus, completedAt: now()
  })

  # 7. Schedule auto-retry if applicable
  if status != "succeeded" and agentConfig.maxRetries > 0:
    currentAttempt = get_attempt_count(workspace._id)
    if currentAttempt < agentConfig.maxRetries:
      delay = min(agentConfig.retryBackoffMs * 2^(currentAttempt - 1), agentConfig.maxRetryBackoffMs)
      convex.mutation(api.retries.schedule, {
        workspaceId: workspace._id,
        attemptNumber: currentAttempt + 1,
        dueAt: now() + delay,
        error: describe_error(result)
      })
```

### 21.4 Graceful Shutdown

```text
function graceful_shutdown(convex, config, running_tasks):
  log("Shutting down, cancelling ${len(running_tasks)} running agents")

  for task in running_tasks:
    task.abortController.abort()  # Triggers SIGTERM -> SIGKILL cascade

  # Wait for all tasks to finish (up to 30 seconds)
  wait_all(running_tasks, timeout: 30000)

  # Any still-running tasks will be detected as orphaned on next startup
  log("Worker shutdown complete")
```

## 22. Test and Validation Matrix

A conforming implementation should include tests that cover the behaviors defined in this specification.

### 22.1 Board and Issue Management

- Project creation with default columns.
- Issue CRUD (create, read, update, delete).
- Issue move between columns (status change).
- Blocker relationships (blockedBy).
- Issue ordering within columns (position).
- Tag filtering.
- Simple ID generation (sequential, unique per project).
- Column CRUD (add, rename, reorder, delete with issue migration).
- Auto-dispatch trigger on column entry.

### 22.2 Workspace and Worktree Management

- Single-repo workspace creation (worktree created, status transitions to `ready`).
- Multi-repo workspace creation (worktree per repo, all in one directory).
- Worktree cleanup on workspace deletion.
- Partial creation failure (rollback already-created worktrees).
- Branch naming follows `yes-kanban/<slug>/<simpleId>` pattern.
- Branch name sanitization (special characters replaced).
- Workspace path stays inside workspace root (path traversal rejected).
- Multiple workspaces per issue.
- Standalone workspaces (no issue).
- Setup script runs after worktree creation and failure is fatal.
- Before-run script runs before agent launch and failure is fatal.
- After-run script runs after agent exit and failure is ignored.
- Cleanup script runs before removal and failure is ignored.
- Hook timeout enforcement.

### 22.3 Agent Execution

- Claude Code adapter builds correct CLI command with all flags.
- Agent subprocess launches in correct `cwd`.
- Stdout/stderr lines are captured and written to Convex.
- Structured JSON output is parsed for Claude Code `stream-json` format.
- Process exit code 0 maps to `succeeded`.
- Process exit code non-zero maps to `failed`.
- Timeout enforcement kills process and records `timed_out`.
- Stall detection kills process and records `failed` with stall error.
- Stall detection disabled when `stallTimeoutMs <= 0`.
- Cancellation sends SIGTERM then SIGKILL after 5 seconds.
- Token usage extraction from agent output.
- Environment variables from agent config are passed to subprocess.

### 22.4 Dispatch and Orchestration

- Manual dispatch creates workspace and starts agent.
- Auto-dispatch triggers when issue enters auto-dispatch column.
- Auto-dispatch does not trigger for issues already running.
- Auto-dispatch is no-op when no default agent config is set.
- Dispatch ordering: oldest queued workspace first (FIFO by workspace creation time).
- Blocker-aware dispatch: blocked issues are not dispatched.
- Blocker-aware dispatch: issues become eligible when blockers clear.
- Global concurrency limit respected.
- Per-column concurrency limit respected (when configured).
- Queue drains when slots free up.

### 22.5 Retry and Backoff

- Manual retry creates new run attempt in existing workspace.
- Retry prompt includes continuation context.
- Auto-retry schedules next attempt with exponential backoff.
- Auto-retry respects `maxRetries` limit.
- Auto-retry abandons if issue moved to terminal column.
- Auto-retry requeues if no slots available.
- Backoff formula: `min(base * 2^(attempt-1), max)`.
- Continuation retries use 1-second fixed delay.

### 22.6 Forge Integration

- GitHub adapter detects `gh` CLI availability.
- PR creation for single-repo workspace.
- PR creation for multi-repo workspace (one PR per repo with changes).
- PR title and body default to issue title and description.
- PR status check returns existing PR info.

### 22.7 Observability

- Agent output logs are written to Convex in real-time.
- Worker operational logs include structured context fields.
- Dispatch status endpoint returns running/queued counts.
- Token usage aggregated across runs.
- Hook failures are logged with context.
- Log write failures do not crash the worker.

### 22.8 Worker Lifecycle

- Worker startup connects to Convex.
- Worker startup recovers orphaned workspaces (marks as `failed`).
- Worker graceful shutdown cancels running agents.
- Worker reconnects after Convex disconnection.
- Worker exit code 0 on normal shutdown, non-zero on startup failure.

### 22.9 Development Lifecycle

- Workspace progresses through stages: creating → coding → reviewing → testing → rebasing → pr_open → merged.
- Review stage creates a fresh run attempt with `type: review`.
- Review agent receives diff and issue context but NOT coding agent conversation history.
- Review approve is followed by the Testing stage (when tests are enabled), then completion and user-driven rebase/PR/merge actions.
- Review request-changes dispatches coding agent with feedback context (tests do not run until a review round approves).
- Testing stage runs configured `testCommand` and captures output.
- Testing stage skipped when `testCommand` is null.
- Test failure triggers one inline test-fix coding run (prompt + optional `get_test_results` MCP), then re-runs tests (no re-review).
- Test failure sets `test_failed` if tests still fail after that attempt.
- Review cycles capped at `maxReviewCycles`.
- Review stage skipped when `skipReview` is true on column.
- Rebase stage runs `git rebase` and handles clean success.
- Rebase conflict dispatches coding agent to resolve.
- After conflict resolution, workspace continues reviewing then testing (after approval) as in the normal lifecycle.
- PR creation pushes branch and creates PR via forge adapter.
- Auto-merge enabled when column `mergePolicy` is `auto_merge`.
- Manual merge waits for user action when `mergePolicy` is `manual_merge`.
- Local merge (`local_merge`) squash-merges the feature branch into the base locally (`git merge --squash` plus one commit), skipping PR creation. Enables fully offline workflow.
- Merged status moves issue to Done column.
- Worktree cleanup after configurable delay post-merge.
- Column lifecycle config (mergePolicy, skipReview, skipTests) respected.

### 22.10 MCP Server

- MCP server starts when agent launches (if `mcpEnabled: true`).
- MCP server shuts down when agent exits.
- `create_issue` creates an issue visible in Convex immediately.
- `update_issue` modifies issue fields.
- `delete_issue` removes the issue.
- `get_issue` returns full issue details.
- `list_issues` returns filtered results.
- `add_comment` creates a comment linked to the run attempt.
- `list_comments` returns comments sorted by creation time.
- `add_blocker` / `remove_blocker` modifies `blockedBy` relationships.
- `get_current_issue` returns the workspace's associated issue.
- `get_test_results` returns status, exit code, error, and log lines for the most recent test run attempt (`type: test`).
- `mcpTools` allowlist restricts available tools.
- Disallowed tool calls return an error without executing.
- Rate limiting enforced (60 calls/min/workspace).
- Tool calls logged as agent log entries.

### 22.11 Real Integration Profile (Recommended)

These checks require a running Convex instance and Git repos:

- End-to-end: create issue, dispatch agent, capture output, verify workspace has changes.
- End-to-end: auto-dispatch from column move.
- End-to-end: create PR from workspace.
- Hook execution on actual filesystem.
- Multi-repo workspace with real git worktrees.

## 23. Implementation Checklist (Definition of Done)

A conforming implementation must complete all items below.

### 23.1 Data Layer

- Convex schema deployed with all tables and indexes.
- Project CRUD with default columns on creation.
- Column CRUD (add, rename, reorder, delete with issue migration).
- Issue CRUD with simple ID generation.
- Blocker relationships (blockedBy).
- Attachment upload, storage, and display.
- Issue ordering within columns (position field).

### 23.2 Board UI

- Kanban board view with drag-and-drop between columns.
- Issue detail modal (Jira-style centered dialog) with inline editing (title, description, tags, status).
- List view for all issues including hidden columns.
- Filter by tags, search text, workspace status (board).
- Sort by created date, updated date, manual order.
- Settings UI for projects, columns, repos, agent configs.

### 23.3 Workspace and Worktree Management

- Single-repo and multi-repo workspace creation with git worktrees.
- Worktree cleanup on workspace deletion.
- Partial creation rollback on failure.
- Branch naming: `yes-kanban/<slug>/<simpleId>`.
- Path sanitization and workspace root containment.
- Multiple workspaces per issue.
- Standalone workspaces (no issue).
- All four workspace hooks (setup, before-run, after-run, cleanup) with timeout enforcement.

### 23.4 Agent Execution

- Claude Code adapter with `stream-json` output parsing.
- Codex CLI adapter.
- Cursor Agent CLI adapter (including `editToolCall` events that only carry `diffString`: the worker parses the unified fragment into old/new text for the agent log, and surfaces `linesAdded` / `linesRemoved` metadata when present).
- Agent log streaming to Convex and real-time display in UI.
- Code diff viewer for workspace changes.
- Timeout enforcement.
- Stall detection with configurable threshold.
- Token usage extraction and tracking.
- Cancellation (SIGTERM → SIGKILL cascade).

### 23.5 Dispatch and Orchestration

- Manual dispatch from UI.
- Auto-dispatch from configured columns.
- Global concurrency limiting.
- Per-column concurrency limits.
- Blocker-aware dispatch (blocked issues wait until blockers clear).
- Dispatch FIFO ordering for queued workspaces.
- Manual retry from UI with continuation context.
- Auto-retry with exponential backoff.
- Queue drains when slots free up.

### 23.6 Development Lifecycle

- Full lifecycle flow: creating → coding → reviewing → testing → rebasing → pr_open → merged.
- Independent review stage with fresh agent context (diff only, no conversation history).
- Review approve/request-changes flow with configurable max cycles (tests run after approval, not during fix cycles).
- Testing stage with configurable test command per repo.
- Test failure re-dispatches coding agent with failure context (without another review round).
- Rebase onto latest base branch before PR.
- Conflict detection and agent-driven resolution.
- Column-level lifecycle config (mergePolicy, skipReview, skipTests).
- Auto-merge via forge adapter when configured.
- Manual merge detection (periodic PR status polling).
- Local merge via squash merge (`git merge --squash` and a single commit) for offline workflows (no forge/PR required).
- Post-merge issue status update and delayed worktree cleanup.
- Review agent configurable separately from coding agent.

### 23.7 Forge Integration

- GitHub PR creation via `gh` CLI.
- GitLab PR creation via `glab` CLI.
- Azure DevOps PR creation via `az repos` CLI.
- Multi-repo PR creation (one PR per repo with changes, cross-referenced).
- PR status checking.

### 23.8 Worker

- Worker startup with Convex connection.
- Orphaned workspace recovery on restart.
- Graceful shutdown with agent cancellation.
- Remote worker mode (connect to Convex over network).
- Multiple workers on same Convex instance.
- Structured logging with context fields.
- Dispatch status reporting (running/queued counts, token totals).

### 23.9 Observability

- Real-time agent log streaming in UI.
- Worker health indicators in UI.
- Token usage dashboard.
- Cost tracking and API usage reporting.

### 23.10 MCP Server

- MCP server with full issue CRUD tools (create, read, update, delete, move, list).
- Comment tools (add, list) with run attempt linkage.
- Relationship tools (add/remove blockers).
- Board context tools (get current issue, project columns, workspace info).
- Per-agent tool allowlisting via `mcpTools`.
- MCP server lifecycle (start with agent, stop on exit).
- Rate limiting (60 calls/min/workspace).
- Tool call logging as agent log entries.
- Claude Code MCP config generation.

