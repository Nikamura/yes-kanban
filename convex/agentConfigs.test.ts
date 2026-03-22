import { describe, test, expect } from "bun:test";
import { validateAgentConfigArgs } from "./lib/agentConfigValidation";

describe("validateAgentConfigArgs", () => {
  test("accepts valid args with no optional fields", () => {
    expect(() => validateAgentConfigArgs({})).not.toThrow();
  });

  test("accepts valid args with all fields", () => {
    expect(() =>
      validateAgentConfigArgs({
        name: "my-agent",
        command: "claude",
        timeoutMs: 60000,
        maxRetries: 3,
        retryBackoffMs: 5000,
        maxRetryBackoffMs: 60000,
      })
    ).not.toThrow();
  });

  // Name validation
  test("rejects empty name", () => {
    expect(() => validateAgentConfigArgs({ name: "" })).toThrow(
      "Name must not be empty"
    );
  });

  test("rejects whitespace-only name", () => {
    expect(() => validateAgentConfigArgs({ name: "   " })).toThrow(
      "Name must not be empty"
    );
  });

  // Command validation
  test("rejects empty command", () => {
    expect(() => validateAgentConfigArgs({ command: "" })).toThrow(
      "Command must not be empty"
    );
  });

  // Timeout validation
  test("rejects timeout below 1000ms", () => {
    expect(() => validateAgentConfigArgs({ timeoutMs: 500 })).toThrow(
      "Timeout must be between"
    );
  });

  test("rejects timeout above 3,600,000ms", () => {
    expect(() => validateAgentConfigArgs({ timeoutMs: 3600001 })).toThrow(
      "Timeout must be between"
    );
  });

  test("accepts timeout at boundaries", () => {
    expect(() => validateAgentConfigArgs({ timeoutMs: 1000 })).not.toThrow();
    expect(() => validateAgentConfigArgs({ timeoutMs: 3600000 })).not.toThrow();
  });

  // Max retries validation
  test("rejects negative retries", () => {
    expect(() => validateAgentConfigArgs({ maxRetries: -1 })).toThrow(
      "Max retries must be an integer between 0 and 10"
    );
  });

  test("rejects retries above 10", () => {
    expect(() => validateAgentConfigArgs({ maxRetries: 11 })).toThrow(
      "Max retries must be an integer between 0 and 10"
    );
  });

  test("rejects non-integer retries", () => {
    expect(() => validateAgentConfigArgs({ maxRetries: 2.5 })).toThrow(
      "Max retries must be an integer between 0 and 10"
    );
  });

  test("accepts retries at boundaries", () => {
    expect(() => validateAgentConfigArgs({ maxRetries: 0 })).not.toThrow();
    expect(() => validateAgentConfigArgs({ maxRetries: 10 })).not.toThrow();
  });

  // Retry backoff validation
  test("rejects retry backoff below 1000ms", () => {
    expect(() => validateAgentConfigArgs({ retryBackoffMs: 100 })).toThrow(
      "Retry backoff must be between"
    );
  });

  test("rejects retry backoff above 300,000ms", () => {
    expect(() => validateAgentConfigArgs({ retryBackoffMs: 300001 })).toThrow(
      "Retry backoff must be between"
    );
  });

  // Max retry backoff validation
  test("rejects max retry backoff below 1000ms", () => {
    expect(() => validateAgentConfigArgs({ maxRetryBackoffMs: 100 })).toThrow(
      "Max retry backoff must be between"
    );
  });

  test("rejects max retry backoff above 600,000ms", () => {
    expect(() =>
      validateAgentConfigArgs({ maxRetryBackoffMs: 600001 })
    ).toThrow("Max retry backoff must be between");
  });

  // Cross-field validation
  test("rejects maxRetryBackoffMs less than retryBackoffMs", () => {
    expect(() =>
      validateAgentConfigArgs({
        retryBackoffMs: 10000,
        maxRetryBackoffMs: 5000,
      })
    ).toThrow(
      "Max retry backoff must be greater than or equal to retry backoff"
    );
  });

  test("accepts maxRetryBackoffMs equal to retryBackoffMs", () => {
    expect(() =>
      validateAgentConfigArgs({
        retryBackoffMs: 10000,
        maxRetryBackoffMs: 10000,
      })
    ).not.toThrow();
  });
});
