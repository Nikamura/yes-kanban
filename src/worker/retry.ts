/**
 * Auto-retry with exponential backoff logic.
 *
 * Failure retries: delay = min(retryBackoffMs * 2^(attempt-1), maxRetryBackoffMs)
 * Continuation retries: fixed 1000ms delay
 */

export interface BackoffConfig {
  retryBackoffMs: number;
  maxRetryBackoffMs: number;
}

export interface RetryContext {
  attemptNumber: number;
  agentConfig: {
    maxRetries: number;
    retryBackoffMs: number;
    maxRetryBackoffMs: number;
  };
  issueStatus?: string;
  terminalStatuses: string[];
}

export type RetryType = "failure" | "continuation";

/** Issue statuses that indicate the issue is finished and retries should be abandoned. */
export const TERMINAL_STATUSES = ["Done", "Cancelled"] as const;

/**
 * Check if an issue status is terminal (Done or Cancelled).
 */
export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Compute the backoff delay for a retry attempt.
 */
export function computeBackoffDelay(
  config: BackoffConfig,
  attemptNumber: number,
  type: RetryType,
): number {
  if (type === "continuation") {
    return 1000;
  }
  const delay = config.retryBackoffMs * Math.pow(2, attemptNumber - 1);
  return Math.min(delay, config.maxRetryBackoffMs);
}

/**
 * Determine whether a retry should be attempted.
 */
export function shouldRetry(ctx: RetryContext): boolean {
  if (ctx.agentConfig.maxRetries <= 0) return false;
  if (ctx.attemptNumber >= ctx.agentConfig.maxRetries) return false;
  if (
    ctx.issueStatus &&
    ctx.terminalStatuses.includes(ctx.issueStatus)
  ) {
    return false;
  }
  return true;
}
