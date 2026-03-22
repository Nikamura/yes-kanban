---
name: codex-practices
description: >
  OpenAI Codex CLI best practices, sandbox modes, approval policies, and
  integration patterns. Use this skill whenever working with codex CLI,
  codex adapter code, codex sandbox configuration, codex exec mode, codex
  app server, codex MCP integration, codex worktrees, or any code that
  spawns or communicates with the codex process. Also trigger when configuring
  codex approval policies, sandbox modes, or debugging codex CLI issues.
---

# Codex CLI Practices

This project may integrate with **Codex** (OpenAI's coding agent CLI).

## Reference

For detailed Codex docs, fetch the latest documentation:

1. Start with `https://developers.openai.com/codex/llms.txt` to get the documentation index
2. Find the relevant section URL for your topic
3. Fetch that specific page for detailed docs
4. If the index is insufficient, try `https://developers.openai.com/codex/llms-full.txt` for the full documentation

If the URL is unavailable, fall back to your training knowledge or web search.

## Sandbox Modes

Codex uses OS-enforced sandboxing (Seatbelt on macOS, bubblewrap+seccomp on Linux) with three preset modes:

- **`read-only`** (default): Can read files but requires approval for all writes and commands
- **`workspace-write`**: Can write within the project directory, requires approval for outside changes
- **`danger-full-access`** (`--full-auto`): Automatic execution within workspace, approval only for network/out-of-scope operations

Protected paths (`.git`, `.agents`, `.codex`) are always read-only regardless of mode.

## Approval Policies

Two layers work together:

- **Sandbox mode**: What Codex *can* do technically
- **Approval policy**: When Codex must *ask* before acting

Granular approval policies can control sandbox approvals, rules, MCP elicitations, request permissions, and skill approvals independently.

## Exec (Non-Interactive) Mode

```bash
codex exec "task description"
```

Runs a task non-interactively -- useful for CI, scripting, or automation. Combine with `--full-auto` for fully autonomous execution.

## CLI Key Flags

- `--model` / `-m`: Select model (default: codex-mini)
- `--full-auto` / `-f`: Enable full auto-approval mode
- `--quiet` / `-q`: Suppress non-essential output
- `--approval-policy`: Set approval mode
- `--search`: Enable web search capability
- `--no-project-doc`: Skip loading AGENTS.md files

## App Server Protocol

The Codex app communicates via JSON-RPC 2.0 over stdin/stdout (JSONL) or experimental WebSocket. Key concepts:

- **Initialize** once, then manage thread lifecycle
- **Stream** turn-based events including command execution and tool calls
- **Two-phase cloud runtime**: setup (with network) then agent phase (offline by default)

## MCP Integration

Codex supports MCP servers configured in `codex.toml` or `.codex/` directory. MCP tools are available to the agent alongside built-in tools.

## Worktrees

Codex can use git worktrees for parallel task execution, enabling multiple agents to work on different tasks without interfering with the main working tree.

## Configuration

Codex is configured via `codex.toml` (project-level) or `~/.codex/config.toml` (global). Key settings:

- Model and provider selection
- Approval policies and sandbox configuration
- MCP server configuration
- Custom instructions and project markers
