---
name: cursor-practices
description: >
  Cursor CLI (agent command) integration patterns, session management, and MCP
  configuration. Use this skill whenever working on adapters/cursor.ts, configuring
  Cursor agent sessions, or debugging Cursor CLI stream-json output. Also trigger
  when discussing --force/--yolo flags, .cursor/mcp.json auto-detection, or
  Cursor's tool_call event format.
---

# Cursor CLI Practices

This project can orchestrate **Cursor CLI** (`agent` command) sessions as AI agents that work on kanban issues. The worker spawns Cursor processes, monitors their NDJSON output, and captures structured events.

## How this project uses Cursor CLI

1. **Worktree isolation** -- each issue gets its own git worktree
2. **Agent execution** -- Cursor runs in the worktree with `--output-format stream-json`
3. **MCP integration** -- `.cursor/mcp.json` is written to the worktree for auto-detection
4. **Adapter** -- `adapters/cursor.ts` handles CLI flags and output parsing

## Cursor CLI usage

### Running in non-interactive mode

```bash
# One-shot prompt
agent -p "your prompt here"

# Structured output (NDJSON)
agent -p "prompt" --output-format stream-json

# Force mode (skip all permission prompts)
agent -p "prompt" --force

# Plan mode (read-only, no file writes)
agent -p "prompt" --mode plan

# Resume a previous session
agent --resume <session-id> -p "continue working"

# Specify model
agent -p "prompt" --model <model-name>

# Specify workspace directory
agent -p "prompt" --workspace /path/to/workspace
```

### Key CLI flags

| Flag | Purpose |
|------|---------|
| `-p` | Non-interactive prompt (required for automation) |
| `--output-format stream-json` | Streaming NDJSON output |
| `--model` | Override model |
| `--resume <id>` | Resume specific session |
| `--force` / `--yolo` | Skip all permission prompts |
| `--mode plan\|ask\|agent` | Set operation mode |
| `--approve-mcps` | Auto-approve MCP server connections |
| `--workspace <path>` | Set workspace directory |

### Permission modes

- **default** -- asks for approval on risky operations
- **plan** -- read-only, no file writes or commands
- **force** -- auto-approve everything (use with worktree isolation)

This project uses `--force` when the agent runs in an isolated worktree, and `--mode plan` for safe analysis tasks.

## MCP integration

Cursor auto-detects MCP servers from `.cursor/mcp.json` in the workspace root. The lifecycle writes this file before spawning Cursor:

```json
{
  "mcpServers": {
    "yes-kanban": {
      "command": "bun",
      "args": ["run", "/tmp/yes-kanban-mcp-bridge-<id>.ts"]
    }
  }
}
```

Use `--approve-mcps` to auto-approve MCP server connections without prompting.

## Stream-JSON event format

Cursor's `stream-json` output emits newline-delimited JSON. Event types:

| Event | Description |
|-------|-------------|
| `{"type": "system"}` | System initialization |
| `{"type": "assistant", "message": {...}}` | Assistant response with content blocks |
| `{"type": "tool_call", "subtype": "started"}` | Tool call initiated |
| `{"type": "tool_call", "subtype": "completed"}` | Tool call finished with result |
| `{"type": "user", "message": {...}}` | User message (contains tool_result blocks) |
| `{"type": "result", "session_id": "...", "usage": {...}}` | Final result with session ID and token usage |

### Key differences from Claude Code

| Feature | Claude Code | Cursor CLI |
|---------|-------------|------------|
| Command | `claude` | `agent` |
| MCP config | `--mcp-config <path>` | Auto-detects `.cursor/mcp.json` |
| Permission bypass | `--dangerously-skip-permissions` | `--force` / `--yolo` |
| Tool events | `tool_use` / `tool_result` types | `tool_call` with `started`/`completed` subtypes |
| Settings isolation | `--setting-sources ""` | Not available |
| Max turns | `--max-turns N` | Not available |

## Session management

### Session resumption

When retrying or continuing work, use `--resume <session-id>` to maintain context. The session ID is extracted from the `result` event's `session_id` field.

### Token usage

Token usage data comes from the `result` event's `usage` field:
```json
{"type": "result", "usage": {"input_tokens": 1234, "output_tokens": 567}, "session_id": "sess_abc"}
```
