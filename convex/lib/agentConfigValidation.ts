export function validateAgentConfigArgs(args: {
  name?: string;
  command?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  maxRetryBackoffMs?: number;
}): void {
  if (args.name !== undefined && !args.name.trim()) {
    throw new Error("Name must not be empty");
  }
  if (args.command !== undefined && !args.command.trim()) {
    throw new Error("Command must not be empty");
  }
  if (args.timeoutMs !== undefined) {
    if (args.timeoutMs < 1000 || args.timeoutMs > 3600000) {
      throw new Error("Timeout must be between 1,000 ms (1s) and 3,600,000 ms (1h)");
    }
  }
  if (args.maxRetries !== undefined) {
    if (!Number.isInteger(args.maxRetries) || args.maxRetries < 0 || args.maxRetries > 10) {
      throw new Error("Max retries must be an integer between 0 and 10");
    }
  }
  if (args.retryBackoffMs !== undefined) {
    if (args.retryBackoffMs < 1000 || args.retryBackoffMs > 300000) {
      throw new Error("Retry backoff must be between 1,000 ms (1s) and 300,000 ms (5m)");
    }
  }
  if (args.maxRetryBackoffMs !== undefined) {
    if (args.maxRetryBackoffMs < 1000 || args.maxRetryBackoffMs > 600000) {
      throw new Error("Max retry backoff must be between 1,000 ms (1s) and 600,000 ms (10m)");
    }
  }
  if (args.retryBackoffMs !== undefined && args.maxRetryBackoffMs !== undefined) {
    if (args.maxRetryBackoffMs < args.retryBackoffMs) {
      throw new Error("Max retry backoff must be greater than or equal to retry backoff");
    }
  }
}
