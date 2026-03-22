export interface AgentAdvancedForm {
  args: string;
  timeoutMs: string;
  maxRetries: string;
  retryBackoffMs: string;
  maxRetryBackoffMs: string;
  env: string;
  mcpEnabled: boolean;
  mcpTools: string;
}

export function parseEnvString(s: string): Record<string, string> | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const result: Record<string, string> = {};
  for (const line of trimmed.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function envToString(env: Record<string, string> | undefined): string {
  if (!env) return "";
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
}

export function parseOptionalStringArray(s: string): string[] | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  return trimmed.split(",").map((t) => t.trim()).filter(Boolean);
}

export function parseArgs(s: string): string[] | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  return trimmed.split("\n").map((t) => t.trim()).filter(Boolean);
}

export function argsToString(args: string[] | undefined): string {
  if (!args || args.length === 0) return "";
  return args.join("\n");
}

export function validateAgentAdvanced(form: AgentAdvancedForm): string | null {
  const timeout = Number(form.timeoutMs);
  if (!form.timeoutMs || isNaN(timeout) || timeout < 1) return "Timeout must be at least 1 minute";
  const maxRetries = Number(form.maxRetries);
  if (form.maxRetries === "" || isNaN(maxRetries) || maxRetries < 0) return "Max retries must be 0 or greater";
  const backoff = Number(form.retryBackoffMs);
  if (!form.retryBackoffMs || isNaN(backoff) || backoff < 1) return "Retry backoff must be at least 1 second";
  const maxBackoff = Number(form.maxRetryBackoffMs);
  if (!form.maxRetryBackoffMs || isNaN(maxBackoff) || maxBackoff < 1) return "Max retry backoff must be at least 1 second";
  if (maxBackoff < backoff) return "Max retry backoff must be >= retry backoff";
  return null;
}
