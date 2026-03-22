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

## Models

Codex supports multiple model tiers:

- **gpt-5.4** — Flagship frontier model for professional work (recommended default)
- **gpt-5.4-mini** — Faster, cost-effective for responsive tasks and subagents
- **gpt-5.3-codex** — Industry-leading coding model for complex software engineering
- **gpt-5.3-codex-spark** — Text-only research preview, optimized for rapid iteration

Set via `config.toml` (`model = "gpt-5.4"`), CLI flag (`-m gpt-5.4`), or `/model` in interactive mode.

## Sandbox Modes

Codex uses OS-enforced sandboxing (Seatbelt on macOS, Landlock on Linux) with three preset modes:

- **`read-only`** (default): Can read files but requires approval for all writes and commands
- **`workspace-write`**: Can write within the project directory, requires approval for outside changes
- **`danger-full-access`** (`--full-auto`): Automatic execution within workspace, approval only for network/out-of-scope operations

Protected paths (`.git`, `.agents`, `.codex`) are always read-only regardless of mode.

Set via `--sandbox <mode>` flag or `sandbox_mode` in config.toml.

## Approval Policies

Two layers work together:

- **Sandbox mode**: What Codex *can* do technically
- **Approval policy**: When Codex must *ask* before acting

Approval policy values: `untrusted`, `on-request`, `never`.

Granular approval can be configured per category:
- `sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, `skill_approval`

Set via `--ask-for-approval <policy>` flag or `approval_policy` in config.toml.

## Exec (Non-Interactive) Mode

```bash
codex exec "task description"
codex exec --json "task description"    # JSONL structured output
codex exec resume <session_id>          # Resume previous session
```

Runs a task non-interactively — useful for CI, scripting, or automation. Key exec-specific flags:

- `--json` — Print newline-delimited JSON events (for structured parsing)
- `--ephemeral` — Run without persisting session files
- `--skip-git-repo-check` — Allow non-Git directories
- `--output-schema <path>` — JSON Schema for response validation
- `--output-last-message, -o <path>` — Write final message to file
- `--color always|never|auto` — ANSI color control

Combine with `--full-auto` or `--yolo` for fully autonomous execution.

## CLI Key Flags

| Flag | Description |
|------|-------------|
| `--model, -m` | Select model |
| `--full-auto, -f` | Low-friction local work preset |
| `--yolo` | Bypass approvals and sandboxing entirely |
| `--sandbox, -s` | Set sandbox policy (`read-only`, `workspace-write`, `danger-full-access`) |
| `--ask-for-approval, -a` | Control approval pauses (`untrusted`, `on-request`, `never`) |
| `--profile, -p` | Load configuration profile |
| `--ephemeral` | No session persistence |
| `--skip-git-repo-check` | Allow non-Git directories |
| `--no-project-doc` | Skip loading AGENTS.md files |
| `--search` | Enable live web search |
| `--add-dir` | Grant write access to additional directories |
| `--image, -i` | Attach images to prompt |
| `--config, -c` | Inline config overrides (`key=value`) |
| `--enable/--disable` | Toggle feature flags |

## Commands & Subcommands

| Command | Description |
|---------|-------------|
| `codex` | Interactive terminal UI |
| `codex exec` | Non-interactive execution |
| `codex resume` | Continue previous session |
| `codex fork` | Fork session into new thread |
| `codex cloud exec` | Submit task to cloud environment |
| `codex cloud list` | List recent cloud tasks |
| `codex apply` | Apply cloud task diff locally |
| `codex mcp list/get/add/remove` | Manage MCP servers |
| `codex mcp login/logout` | MCP OAuth authentication |
| `codex mcp-server` | Run Codex itself as an MCP server |
| `codex features list/enable/disable` | Manage feature flags |
| `codex execpolicy` | Evaluate exec policy rules |
| `codex app-server` | Launch app server (JSON-RPC/WebSocket) |
| `codex login/logout` | Authentication management |
| `codex completion` | Shell completion scripts |
| `codex sandbox` | Run command in sandbox |

## App Server Protocol

The Codex app communicates via JSON-RPC 2.0 over stdin/stdout (JSONL) or experimental WebSocket. Key concepts:

- **Initialize** once, then manage thread lifecycle
- **Stream** turn-based events including command execution and tool calls
- **Two-phase cloud runtime**: setup (with network) then agent phase (offline by default)

## MCP Integration

Codex supports MCP servers configured in `config.toml`:

```toml
[mcp_servers.my-server]
command = "bun"
args = ["run", "/path/to/server.ts"]
env = { API_KEY = "value" }
enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled_tools = ["tool_a", "tool_b"]   # Allowlist
disabled_tools = ["tool_c"]             # Denylist
```

HTTP-based MCP servers are also supported:

```toml
[mcp_servers.remote]
url = "https://mcp.example.com"
bearer_token_env_var = "MCP_TOKEN"
```

Management commands: `codex mcp add/list/get/remove/login/logout`.

MCP tools are available to the agent alongside built-in tools.

## Worktrees

Codex can use git worktrees for parallel task execution, enabling multiple agents to work on different tasks without interfering with the main working tree.

## Configuration

Codex is configured via `.codex/config.toml` (project-level) or `~/.codex/config.toml` (global). The `CODEX_HOME` env var overrides the global config directory.

Key settings:

- **Model**: `model`, `review_model`, `model_provider`
- **Approval & sandbox**: `approval_policy`, `sandbox_mode`, `sandbox_workspace_write.*`
- **MCP servers**: `[mcp_servers.<name>]` with `command`, `args`, `env`, `enabled_tools`, `disabled_tools`
- **Profiles**: `[profiles.<name>]` — override any top-level key per profile
- **Feature flags**: `[features]` section for toggling capabilities
- **Instructions**: `developer_instructions`, `model_instructions_file`
- **Permissions**: `[permissions.<name>]` with filesystem and network rules
- **Shell**: `shell_environment_policy`, `allow_login_shell`
- **History**: `history.persistence`, `history.max_bytes`
- **Personality**: `none | friendly | pragmatic`
- **Service tier**: `flex | fast`

A JSON schema is available at `https://developers.openai.com/codex/config-schema.json` for editor autocompletion.

## Code Review

The `/review` command supports multiple modes:
- Branch-based diffs
- Uncommitted changes
- Specific commits
- Custom review instructions

Set a dedicated review model via `review_model` in config.

## Subagents

Codex supports subagent workflows for parallelizing larger tasks. Configure via `[agents]` section with `max_threads`, `max_depth`, and per-agent settings.
