/** Max number of delivery attempts (1 original + retries) */
export const MAX_ATTEMPTS = 3;

/** Base delay for exponential backoff in milliseconds */
export const BASE_BACKOFF_MS = 5_000;

/** Retention period for completed delivery records (7 days) */
export const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Calculate exponential backoff delay before the next attempt, with jitter.
 * Jitter prevents retry storms when many webhooks fail simultaneously.
 * @param completedAttempt - The attempt number that just failed (1-based).
 *   The delay is for the gap *after* this attempt, before the next one fires.
 *   Base delays: completedAttempt 1 → 5s, 2 → 10s, 3 → 20s
 * @param random - Random value in [0, 1) for jitter (defaults to Math.random(), injectable for tests)
 */
export function backoffDelay(completedAttempt: number, random: number = Math.random()): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, completedAttempt - 1);
  // Add up to 50% jitter to spread out concurrent retries
  return Math.round(base + random * base * 0.5);
}

export type RetryOutcome =
  | { action: "success" }
  | { action: "retry"; delayMs: number }
  | { action: "dead_letter" };

/**
 * Determine the next action after a delivery attempt completes.
 * @param completedAttempt - The attempt number that just finished (1-based).
 *   e.g. 1 = the original fire(), 2 = first retry, etc.
 * @param maxAttempts - Maximum allowed attempts
 * @param succeeded - Whether this attempt succeeded
 */
export function nextRetryAction(
  completedAttempt: number,
  maxAttempts: number,
  succeeded: boolean
): RetryOutcome {
  if (succeeded) {
    return { action: "success" };
  }
  if (completedAttempt >= maxAttempts) {
    return { action: "dead_letter" };
  }
  return { action: "retry", delayMs: backoffDelay(completedAttempt) };
}
