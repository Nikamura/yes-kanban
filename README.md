# Yes Kanban

A self-hosted kanban board that dispatches AI coding agents to work on your issues. Plan work, dispatch agents, review diffs, merge -- all from one UI.

Each agent runs in its own git worktree, so you can run multiple agents in parallel without branch conflicts. Yes Kanban manages the full lifecycle: worktree creation, agent spawning, log streaming, PR creation, and merge.

Built for solo developers. Mobile-first. Convention over configuration.

## How it works

1. Create a project linked to a git repo.
2. Add issues to the board.
3. Dispatch an issue -- manually, or automatically when it enters a column.
4. The worker creates a worktree, spawns an agent, and streams logs back to the UI in real time.
5. Review the diff. Merge via the UI, or let auto-merge handle it.

## Features

**Board** -- Drag-and-drop columns, priorities, tags, blockers, checklists, comments, recurring issues, issue templates. Hash-based routing so every view is a bookmarkable URL.

**Agent dispatch** -- Supports Claude Code, Codex, Pi, and Cursor via pluggable adapters. Configurable concurrency limits, timeouts, and retry with exponential backoff. Plan mode and dangerously-skip mode.

**MCP integration** -- Built-in MCP server gives agents tools for file operations, search, git status, test execution, and board interaction (create/move issues, ask questions, request permissions).

**Code review** -- Monaco-based diff viewer. File tree visualization. Review feedback loop: leave notes and the agent re-runs.

**PR lifecycle** -- Agents create branches, commit, open PRs, and merge. GitHub, GitLab, and Azure DevOps via forge adapters (`gh`, `glab`, `az` CLIs).

**Real-time** -- All UI reads are Convex subscriptions. No polling. Agent logs stream as they happen.

**Analytics** -- Token usage tracking with cost estimation. Productivity metrics dashboard.

**Import** -- Bring issues from Linear, GitHub Issues, Jira, or CSV.

## Architecture

- **Convex** -- Reactive database. Single source of truth for projects, issues, columns, workspaces, agent logs, and configs.
- **Worker** -- Bun process that polls for dispatched work, manages git worktrees, spawns agent subprocesses, and streams output into Convex.
- **Web UI** -- React 19 SPA with Convex real-time subscriptions. Hash-based routing (`#/<slug>/<view>/<issueId>/ws/<workspaceId>`).

## Quick start

```bash
# Prerequisites: bun, git, a coding agent CLI (e.g. claude)
bun install

# Terminal 1: Convex backend + UI dev server
bun run dev

# Terminal 2: worker process
bun run dev:worker
```

For self-hosted Convex, use the included Docker Compose:

```bash
docker compose up -d    # starts Convex backend on :3210
bun run dev             # UI connects to local backend
bun run dev:worker
```

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Convex backend + Vite dev server |
| `bun run dev:worker` | Worker process (watches for changes) |
| `bun test` | Unit tests |
| `bun run test:e2e` | Playwright E2E tests |
| `bun run test:e2e:isolated` | E2E tests against isolated Convex (Docker) |
| `bun run typecheck` | TypeScript type checking |
| `bun run lint` | ESLint |

## Project structure

```
convex/               Schema, queries, mutations, actions
src/
  ui/
    components/       React components (board, issue detail, settings, etc.)
    hooks/            Custom React hooks
    utils/            Analytics, date formatting, constants
  worker/
    adapters/         Agent adapters (claude-code, codex, pi, plain-text)
    forge/            Git forge integrations (GitHub, GitLab, Azure DevOps)
    importers/        Issue importers (Linear, GitHub, Jira, CSV)
    lifecycle.ts      Core agent orchestration
    agent-executor.ts Subprocess spawning and stream handling
    mcp-server.ts     MCP protocol server
    mcp-tools.ts      Tool definitions for agents
    worktree-manager.ts  Git worktree lifecycle
    prompt-builder.ts Dynamic prompt assembly
e2e/                  Playwright end-to-end tests
.agents/skills/       Agent skills (bun, convex, claude-code, codex, pi)
```

## Configuration

Yes Kanban is opinionated -- configuration is limited to operational knobs:

| Variable | Default | Description |
|---|---|---|
| `CONVEX_URL` | `http://localhost:3210` | Convex backend URL |
| `MAX_CONCURRENT_AGENTS` | `3` | Max agents running in parallel |
| `AGENT_TIMEOUT_MS` | `3600000` (1h) | Per-agent timeout |
| `POLL_INTERVAL_MS` | `3000` | Worker poll frequency |
| `STALL_TIMEOUT_MS` | `300000` (5m) | Stall detection timeout |
| `WORKTREE_ROOT` | `~/.yes-kanban/worktrees` | Where worktrees are created |

## License

Private.
