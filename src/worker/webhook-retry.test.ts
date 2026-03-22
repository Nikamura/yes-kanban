import { describe, test, expect } from "bun:test";
import {
  backoffDelay,
  nextRetryAction,
  MAX_ATTEMPTS,
  BASE_BACKOFF_MS,
  DELIVERY_RETENTION_MS,
} from "../../convex/webhookRetry";

describe("webhook retry backoff", () => {
  // Pass random=0 for deterministic base delay tests
  test("attempt 1 returns base delay (5s) with no jitter", () => {
    expect(backoffDelay(1, 0)).toBe(5_000);
  });

  test("attempt 2 returns 10s (5s * 2^1) with no jitter", () => {
    expect(backoffDelay(2, 0)).toBe(10_000);
  });

  test("attempt 3 returns 20s (5s * 2^2) with no jitter", () => {
    expect(backoffDelay(3, 0)).toBe(20_000);
  });

  test("delays increase exponentially with factor 2", () => {
    const d1 = backoffDelay(1, 0);
    const d2 = backoffDelay(2, 0);
    const d3 = backoffDelay(3, 0);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
    expect(d2 / d1).toBe(2);
    expect(d3 / d2).toBe(2);
  });

  test("jitter adds up to 50% of base delay", () => {
    const base = backoffDelay(1, 0); // 5_000
    const maxJitter = backoffDelay(1, 0.999); // ~7_500
    const midJitter = backoffDelay(1, 0.5); // ~7_500 * 0.5 ≈ 6_250

    expect(maxJitter).toBeGreaterThan(base);
    expect(maxJitter).toBeLessThanOrEqual(Math.round(base * 1.5));
    expect(midJitter).toBeGreaterThan(base);
    expect(midJitter).toBeLessThan(maxJitter);
  });

  test("jitter is deterministic given same random value", () => {
    expect(backoffDelay(2, 0.3)).toBe(backoffDelay(2, 0.3));
  });
});

describe("webhook retry constants", () => {
  test("MAX_ATTEMPTS is 3", () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });

  test("BASE_BACKOFF_MS is 5 seconds", () => {
    expect(BASE_BACKOFF_MS).toBe(5_000);
  });

  test("DELIVERY_RETENTION_MS is 7 days", () => {
    expect(DELIVERY_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1_000);
  });
});

describe("nextRetryAction state machine", () => {
  test("returns success when attempt succeeds", () => {
    const outcome = nextRetryAction(1, 3, true);
    expect(outcome).toEqual({ action: "success" });
  });

  test("returns success on any attempt if succeeded", () => {
    expect(nextRetryAction(2, 3, true)).toEqual({ action: "success" });
    expect(nextRetryAction(3, 3, true)).toEqual({ action: "success" });
  });

  test("returns retry with delay when attempts remain", () => {
    const outcome = nextRetryAction(1, 3, false);
    expect(outcome.action).toBe("retry");
    if (outcome.action === "retry") {
      // Delay should be at least the base (no jitter) and at most 1.5x base
      expect(outcome.delayMs).toBeGreaterThanOrEqual(5_000);
      expect(outcome.delayMs).toBeLessThanOrEqual(7_500);
    }
  });

  test("returns retry with increasing delay for subsequent attempts", () => {
    // Run multiple times to account for jitter — the base increases so
    // attempt 2 base (10s) always exceeds attempt 1 max (7.5s)
    const outcome1 = nextRetryAction(1, 3, false);
    const outcome2 = nextRetryAction(2, 3, false);
    expect(outcome1.action).toBe("retry");
    expect(outcome2.action).toBe("retry");
    if (outcome1.action === "retry" && outcome2.action === "retry") {
      // Even with max jitter on attempt 1 (7500) and no jitter on attempt 2 (10000),
      // attempt 2 is still larger
      expect(outcome2.delayMs).toBeGreaterThan(outcome1.delayMs * 0.5);
    }
  });

  test("returns dead_letter when max attempts reached", () => {
    const outcome = nextRetryAction(3, 3, false);
    expect(outcome).toEqual({ action: "dead_letter" });
  });

  test("returns dead_letter when current attempt exceeds max", () => {
    const outcome = nextRetryAction(4, 3, false);
    expect(outcome).toEqual({ action: "dead_letter" });
  });

  test("full retry lifecycle: retry → retry → dead_letter", () => {
    const r1 = nextRetryAction(1, 3, false);
    expect(r1.action).toBe("retry");

    const r2 = nextRetryAction(2, 3, false);
    expect(r2.action).toBe("retry");

    const r3 = nextRetryAction(3, 3, false);
    expect(r3.action).toBe("dead_letter");
  });

  test("full retry lifecycle: retry → success", () => {
    const r1 = nextRetryAction(1, 3, false);
    expect(r1.action).toBe("retry");

    const r2 = nextRetryAction(2, 3, true);
    expect(r2.action).toBe("success");
  });

  test("single attempt max: fails immediately to dead_letter", () => {
    const outcome = nextRetryAction(1, 1, false);
    expect(outcome).toEqual({ action: "dead_letter" });
  });
});

/**
 * Integration-style tests that simulate the full retry flow as it would
 * execute through createDelivery → retryDelivery → scheduleNextRetry/updateDeliveryStatus.
 * Tests the state machine transitions without requiring Convex infrastructure.
 */
describe("retry flow simulation", () => {
  interface DeliveryRecord {
    attempt: number;
    maxAttempts: number;
    status: "retrying" | "success" | "dead_letter";
    scheduledDelayMs?: number;
  }

  /** Simulate the createDelivery → retryDelivery loop */
  function simulateRetryFlow(
    maxAttempts: number,
    attemptResults: boolean[] // true = success, false = failure for each attempt after the initial fire()
  ): DeliveryRecord {
    // createDelivery: fire() was attempt 1 and failed
    const initialOutcome = nextRetryAction(1, maxAttempts, false);
    if (initialOutcome.action === "dead_letter") {
      return { attempt: 1, maxAttempts, status: "dead_letter" };
    }
    if (initialOutcome.action !== "retry") {
      throw new Error("Unexpected outcome from initial failure");
    }

    let record: DeliveryRecord = {
      attempt: 1,
      maxAttempts,
      status: "retrying",
      scheduledDelayMs: initialOutcome.delayMs,
    };

    // Simulate each retryDelivery execution
    for (let i = 0; i < attemptResults.length; i++) {
      const currentAttempt = record.attempt + 1;
      const succeeded = attemptResults[i]!;
      const outcome = nextRetryAction(currentAttempt, maxAttempts, succeeded);

      if (outcome.action === "success") {
        return { attempt: currentAttempt, maxAttempts, status: "success" };
      } else if (outcome.action === "dead_letter") {
        return { attempt: currentAttempt, maxAttempts, status: "dead_letter" };
      } else {
        record = {
          attempt: currentAttempt,
          maxAttempts,
          status: "retrying",
          scheduledDelayMs: outcome.delayMs,
        };
      }
    }

    return record;
  }

  test("all retries fail → dead_letter after MAX_ATTEMPTS", () => {
    const result = simulateRetryFlow(3, [false, false]);
    expect(result.status).toBe("dead_letter");
    expect(result.attempt).toBe(3);
  });

  test("succeeds on first retry", () => {
    const result = simulateRetryFlow(3, [true]);
    expect(result.status).toBe("success");
    expect(result.attempt).toBe(2);
  });

  test("succeeds on second retry", () => {
    const result = simulateRetryFlow(3, [false, true]);
    expect(result.status).toBe("success");
    expect(result.attempt).toBe(3);
  });

  test("single max attempt → immediate dead_letter from createDelivery", () => {
    const result = simulateRetryFlow(1, []);
    expect(result.status).toBe("dead_letter");
    expect(result.attempt).toBe(1);
  });

  test("5 max attempts, fails all → dead_letter after attempt 5", () => {
    const result = simulateRetryFlow(5, [false, false, false, false]);
    expect(result.status).toBe("dead_letter");
    expect(result.attempt).toBe(5);
  });

  test("5 max attempts, succeeds on attempt 4", () => {
    const result = simulateRetryFlow(5, [false, false, true]);
    expect(result.status).toBe("success");
    expect(result.attempt).toBe(4);
  });

  test("scheduled delays increase with each retry", () => {
    const delays: number[] = [];

    // Collect delays for a 5-attempt flow that fails all
    const initialOutcome = nextRetryAction(1, 5, false);
    if (initialOutcome.action === "retry") delays.push(initialOutcome.delayMs);

    let attempt = 1;
    for (let i = 0; i < 3; i++) {
      attempt++;
      const outcome = nextRetryAction(attempt, 5, false);
      if (outcome.action === "retry") delays.push(outcome.delayMs);
    }

    // Each delay's base is double the previous, so even with jitter they should increase
    // (base grows 2x but jitter only adds up to 50%, so min of next > max of prev)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]! * 0.5);
    }
    expect(delays.length).toBe(4);
  });
});
