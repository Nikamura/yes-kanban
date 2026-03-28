import type { IAgentAdapter } from "../types";
import { assertSupportedAgentAdapterType } from "../../../convex/lib/agentTypes";
import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";
import { CursorAdapter } from "./cursor";
import { OpenCodeAdapter } from "./opencode";

const adapters: Record<string, IAgentAdapter> = {
  "claude-code": new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
  cursor: new CursorAdapter(),
  opencode: new OpenCodeAdapter(),
};

export function getAdapter(agentType: string): IAgentAdapter {
  assertSupportedAgentAdapterType(agentType);
  const adapter = adapters[agentType];
  if (!adapter) {
    throw new Error(`Invariant: no adapter registered for ${agentType}`);
  }
  return adapter;
}
