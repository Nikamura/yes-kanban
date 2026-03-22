import type { IAgentAdapter } from "../types";
import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";
import { CursorAdapter } from "./cursor";
import { PiAdapter } from "./pi";

const adapters: Record<string, IAgentAdapter> = {
  "claude-code": new ClaudeCodeAdapter(),
  pi: new PiAdapter(),
  codex: new CodexAdapter(),
  cursor: new CursorAdapter(),
};

export function getAdapter(agentType: string): IAgentAdapter {
  const adapter = adapters[agentType];
  if (!adapter) {
    throw new Error(`Unknown agent type: ${agentType}. Available: ${Object.keys(adapters).join(", ")}`);
  }
  return adapter;
}
