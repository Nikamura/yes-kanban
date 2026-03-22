import type { Doc } from "../../../convex/_generated/dataModel";
import type { IAgentAdapter, AgentEvent, TokenUsage } from "../types";

/**
 * Generic adapter for agents that output plain text (codex, cursor).
 */
export class PlainTextAdapter implements IAgentAdapter {
  constructor(private agentType: string) {}

  buildCommand(args: {
    config: Doc<"agentConfigs">;
    prompt: string;
    cwd: string;
    mcpConfigPath?: string;
  }): { command: string; args: string[]; env: Record<string, string> } {
    const cmdArgs: string[] = [];

    if (this.agentType === "cursor") {
      cmdArgs.push("-p", args.prompt);
    }

    if (args.config.model) {
      cmdArgs.push("--model", args.config.model);
    }

    if (args.config.args.length > 0) {
      cmdArgs.push(...args.config.args);
    }

    return {
      command: args.config.command,
      args: cmdArgs,
      env: { ...process.env, ...(args.config.env ?? {}) } as Record<string, string>,
    };
  }

  parseLine(_line: string): AgentEvent[] {
    // Plain text agents don't produce structured output
    return [];
  }

  extractTokenUsage(_events: AgentEvent[]): TokenUsage | null {
    return null;
  }

  formatPermissionResponse(_requestId: string, _approved: boolean): string {
    throw new Error(`${this.agentType} adapter does not support permission responses`);
  }
}
