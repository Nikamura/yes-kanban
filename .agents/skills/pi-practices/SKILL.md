---
name: pi-practices
description: >
  Pi coding agent best practices, RPC mode integration, extensions, and context
  engineering. Use this skill whenever working with pi.dev agent, pi adapter code,
  RPC mode communication, pi extensions, pi packages, AGENTS.md, SYSTEM.md,
  pi skills, pi prompt templates, or any code that spawns or communicates with
  the pi process. Also trigger when configuring pi providers/models, session
  management, or debugging pi RPC protocol issues.
---

# Pi Practices

This project integrates with **pi** (@mariozechner/pi-coding-agent), a minimal terminal coding harness.

## Reference

For detailed pi docs, fetch the latest documentation:

1. Start with `https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent` to get the documentation index

If the URL is unavailable, fall back to your training knowledge or web search.

## RPC Mode Integration

Our pi adapter (`src/worker/adapters/pi.ts`) uses RPC mode (`--mode rpc`) over stdin/stdout with JSONL protocol.

### Key patterns

- **Launching**: `pi --mode rpc --no-session` with optional `--model <model>`
- **Sending prompts**: Write JSONL to stdin: `{"type": "prompt", "message": "..."}`
- **Receiving events**: Parse JSONL from stdout -- key event types:
  - `message_update` -- streaming text and tool use updates
  - `message_end` -- turn complete with token usage
  - `extension_ui_request` -- permission/confirmation request from extensions
- **Permission responses**: `{"type": "extension_ui_response", "id": "<requestId>", "confirmed": true/false}`

### Session management

- Use `--no-session` for stateless RPC interactions (our default)
- Sessions are tree-structured JSONL files stored in `~/.pi/agent/sessions/`
- Compaction auto-summarizes when approaching context limits

## Context Engineering

Pi uses a layered context system:

- **AGENTS.md**: Project instructions loaded from `~/.pi/agent/`, parent directories, and current directory
- **SYSTEM.md**: Replace or append to the default system prompt per-project
- **Skills**: On-demand capability packages with instructions and tools (progressive disclosure)
- **Prompt templates**: Reusable Markdown prompts accessible via `/name`
- **Extensions**: TypeScript modules that can inject messages, filter history, implement RAG

## Providers & Models

Pi supports 15+ providers (Anthropic, OpenAI, Google, Azure, Bedrock, Mistral, Groq, etc.). Models are configured via:

- API keys or OAuth subscriptions
- `--model` flag or `/model` command in interactive mode
- Custom providers via `models.json` or extensions

## Extensions

Extensions are TypeScript modules with access to tools, commands, keyboard shortcuts, events, and TUI. Pi deliberately omits features like MCP, sub-agents, permission popups, and plan mode -- these are built via extensions instead.
