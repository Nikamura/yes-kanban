import { describe, expect, it } from "bun:test";
import { computeBackoffDelay, isTerminalStatus, shouldRetry, type RetryContext } from "./retry";

describe("computeBackoffDelay", () => {
  it("computes exponential backoff for failure retries", () => {
    const config = { retryBackoffMs: 10000, maxRetryBackoffMs: 300000 };

    expect(computeBackoffDelay(config, 1, "failure")).toBe(10000); // 10000 * 2^0
    expect(computeBackoffDelay(config, 2, "failure")).toBe(20000); // 10000 * 2^1
    expect(computeBackoffDelay(config, 3, "failure")).toBe(40000); // 10000 * 2^2
    expect(computeBackoffDelay(config, 4, "failure")).toBe(80000); // 10000 * 2^3
  });

  it("caps backoff at maxRetryBackoffMs", () => {
    const config = { retryBackoffMs: 10000, maxRetryBackoffMs: 30000 };

    expect(computeBackoffDelay(config, 1, "failure")).toBe(10000);
    expect(computeBackoffDelay(config, 2, "failure")).toBe(20000);
    expect(computeBackoffDelay(config, 3, "failure")).toBe(30000); // capped
    expect(computeBackoffDelay(config, 4, "failure")).toBe(30000); // still capped
  });

  it("uses fixed 1000ms delay for continuation retries", () => {
    const config = { retryBackoffMs: 10000, maxRetryBackoffMs: 300000 };

    expect(computeBackoffDelay(config, 1, "continuation")).toBe(1000);
    expect(computeBackoffDelay(config, 5, "continuation")).toBe(1000);
  });
});

describe("shouldRetry", () => {
  const baseConfig = {
    maxRetries: 3,
    retryBackoffMs: 10000,
    maxRetryBackoffMs: 300000,
  };

  const terminal = ["Done"] as const;

  it("returns true when retries remain", () => {
    const ctx: RetryContext = {
      attemptNumber: 1,
      agentConfig: baseConfig,
      issueStatus: "In Progress",
      terminalStatuses: [...terminal],
    };
    expect(shouldRetry(ctx)).toBe(true);
  });

  it("returns false when maxRetries is 0 (disabled)", () => {
    const ctx: RetryContext = {
      attemptNumber: 1,
      agentConfig: { ...baseConfig, maxRetries: 0 },
      issueStatus: "In Progress",
      terminalStatuses: [...terminal],
    };
    expect(shouldRetry(ctx)).toBe(false);
  });

  it("returns false when attempts exhausted", () => {
    const ctx: RetryContext = {
      attemptNumber: 3,
      agentConfig: baseConfig,
      issueStatus: "In Progress",
      terminalStatuses: [...terminal],
    };
    expect(shouldRetry(ctx)).toBe(false);
  });

  it("returns false when issue is in terminal status", () => {
    const ctx: RetryContext = {
      attemptNumber: 1,
      agentConfig: baseConfig,
      issueStatus: "Done",
      terminalStatuses: [...terminal],
    };
    expect(shouldRetry(ctx)).toBe(false);
  });

  it("returns true when legacy Cancelled status is passed with Done-only terminal list", () => {
    const ctx: RetryContext = {
      attemptNumber: 1,
      agentConfig: baseConfig,
      issueStatus: "Cancelled",
      terminalStatuses: [...terminal],
    };
    expect(shouldRetry(ctx)).toBe(true);
  });

  it("returns true when no issueStatus is provided (standalone workspace)", () => {
    const ctx: RetryContext = {
      attemptNumber: 1,
      agentConfig: baseConfig,
      terminalStatuses: [...terminal],
    };
    expect(shouldRetry(ctx)).toBe(true);
  });
});

describe("isTerminalStatus", () => {
  it("returns true for Done", () => {
    expect(isTerminalStatus("Done")).toBe(true);
  });

  it("returns false for legacy Cancelled column name", () => {
    expect(isTerminalStatus("Cancelled")).toBe(false);
  });

  it("returns false for In Progress", () => {
    expect(isTerminalStatus("In Progress")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTerminalStatus("")).toBe(false);
  });
});
