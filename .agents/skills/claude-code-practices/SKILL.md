---
name: claude-code-practices
description: >
  Claude Code CLI integration patterns, session management, and agent orchestration.
  Use this skill whenever working on the worker/ directory (agent-executor.ts,
  lifecycle.ts, mcp-server.ts, adapters/claude-code.ts), spawning or managing
  Claude Code sessions, building prompts for Claude, configuring MCP servers,
  implementing hooks, or working with the Claude Code SDK/CLI. Also trigger when
  discussing subagents, agent teams, worktree isolation, session resumption,
  plan mode vs dangerously-skip mode, or any integration between this kanban
  app and the Claude Code CLI. If you see references to `claude` CLI commands,
  CLAUDE.md files, or the claude-code adapter, use this skill.
---

# Claude Code Practices

This project orchestrates **Claude Code CLI** sessions as AI agents that work on kanban issues. The worker spawns Claude Code processes, monitors them, and captures their output.

## Reference

For detailed Claude Code docs, fetch the latest documentation:

1. Start with `https://docs.anthropic.com/en/docs/claude-code/llms.txt` to get the documentation index
2. Find the relevant section URL for your topic
3. Fetch that specific page for detailed docs

If the URL is unavailable, fall back to your training knowledge or web search.

## How this project uses Claude Code

The worker (`src/worker/`) spawns Claude Code CLI processes to work on issues:

1. **Worktree isolation** -- each issue gets its own git worktree (`worktree-manager.ts`)
2. **Agent execution** -- Claude Code runs in the worktree with a crafted prompt (`agent-executor.ts`)
3. **Lifecycle management** -- tracks status, captures output, handles completion/failure (`lifecycle.ts`)
4. **MCP server** -- exposes tools to Claude Code sessions via Model Context Protocol (`mcp-server.ts`)
5. **Adapters** -- `adapters/claude-code.ts` handles the specific CLI interface

## Claude Code CLI usage

### Running in non-interactive mode

```bash
# One-shot prompt (returns result and exits)
claude -p "your prompt here"

# With specific model
claude -p "prompt" --model claude-sonnet-4-20250514

# Streaming JSON output
claude -p "prompt" --output-format stream-json

# Resume a previous session
claude --resume <session-id> -p "continue working"

# Continue the most recent session
claude --continue -p "keep going"
```

### Key CLI flags

| Flag | Purpose |
|------|---------|
| `-p` | Non-interactive prompt (required for automation) |
| `--output-format stream-json` | Streaming structured output |
| `--model` | Override model |
| `--resume <id>` | Resume specific session |
| `--continue` | Resume most recent session |
| `--allowedTools` | Restrict available tools |
| `--disallowedTools` | Block specific tools |
| `--permission-mode` | Set permission level |
| `--max-turns` | Limit conversation turns |

### Permission modes

- **default** -- asks for approval on risky operations
- **plan** -- read-only, no file writes or commands (safe for exploration)
- **dangerously-skip-permissions** -- auto-approve everything (use with worktree isolation)

This project uses `dangerously-skip-permissions` when the agent runs in an isolated worktree, and `plan` mode for safe analysis tasks.

## MCP Server integration

This project runs an MCP server that Claude Code sessions connect to, giving agents access to project-specific tools (e.g., updating issue status, posting comments, reading board state).

Key concepts:
- MCP servers expose tools, resources, and prompts to Claude Code
- The `--mcp-config` flag points Claude Code at the server config
- Tools defined in `mcp-server.ts` let agents interact with the kanban board

## Session management patterns

### Spawning a session

```ts
const proc = Bun.spawn(["claude", "-p", prompt, "--output-format", "stream-json"], {
  cwd: worktreePath,
  env: { ...process.env, ...agentEnv },
  stdout: "pipe",
  stderr: "pipe",
});
```

### Parsing streaming output

Claude Code's `stream-json` format emits newline-delimited JSON. Each message has a `type` field:
- `assistant` -- Claude's response text
- `tool_use` -- tool call
- `tool_result` -- tool output
- `result` -- final result with token usage

### Handling agent questions

When Claude Code asks a question (needs user input), this project captures it and surfaces it on the kanban board for the user to answer.

## Best practices for agent orchestration

### Craft clear, bounded prompts

Give agents specific tasks with clear success criteria. Include:
- What to do
- Which files/directories to focus on
- How to verify completion (run tests, check build)
- Constraints (don't modify unrelated files)

### Use worktree isolation

Always run agents in isolated git worktrees. This prevents concurrent agents from conflicting with each other or the main working tree.

### Handle failures gracefully

Agents can fail for many reasons (timeout, CLI crash, bad output). The retry system (`retry.ts`) uses exponential backoff. Track attempt history in `runAttempts` table.

### Monitor token usage

Track `inputTokens`, `outputTokens`, `totalTokens` from the result message. This data feeds the usage tracking in the kanban UI.

### Session resumption

When retrying or continuing work, use `--resume <session-id>` to maintain conversation context rather than starting fresh. This saves tokens and preserves the agent's understanding of the problem.

## CLAUDE.md and project configuration

The project's `CLAUDE.md` (and identical `AGENTS.md`) provides persistent instructions to every Claude Code session. Keep it concise -- only include rules that apply broadly. Use skills for domain-specific knowledge.
