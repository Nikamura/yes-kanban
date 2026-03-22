/**
 * Supported worker agent adapter keys — must match `getAdapter` registry in
 * `src/worker/adapters/index.ts`.
 */
export const SUPPORTED_AGENT_ADAPTER_TYPES = [
  "claude-code",
  "codex",
  "cursor",
] as const;

export type SupportedAgentAdapterType = (typeof SUPPORTED_AGENT_ADAPTER_TYPES)[number];

export function isSupportedAgentAdapterType(
  t: string,
): t is SupportedAgentAdapterType {
  return (SUPPORTED_AGENT_ADAPTER_TYPES as readonly string[]).includes(t);
}

export function assertSupportedAgentAdapterType(agentType: string): void {
  if (!isSupportedAgentAdapterType(agentType)) {
    throw new Error(
      `Unsupported agent type: ${agentType}. Use one of: ${SUPPORTED_AGENT_ADAPTER_TYPES.join(", ")}`,
    );
  }
}

/**
 * Maps legacy removed adapter identifiers to current supported types.
 * Used by `migrateLegacyAgentTypes` and unit tests.
 */
export function legacyAgentTypeMigrationPatch(
  agentType: string,
  command: string,
): { agentType: string; command: string } | null {
  if (agentType !== "pi") return null;
  return {
    agentType: "claude-code",
    command: command.trim() === "pi" ? "claude" : command,
  };
}
