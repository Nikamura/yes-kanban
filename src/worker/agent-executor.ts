import type { ExecuteResult } from "./types";
import { consumeStreamLines } from "./stream-lines";

/**
 * Kill a process and its entire process group aggressively.
 * Sends SIGTERM first, then SIGKILL after a short delay.
 */
function killProcessTree(proc: ReturnType<typeof Bun.spawn>, reason: string): void {
  const pid = proc.pid;
  console.log(`[executor] pid=${pid} ${reason}, killing process tree`);

  // Kill the process group (negative PID) to catch all child processes
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Process group kill may fail if process already exited; fall back to direct kill
    try { proc.kill("SIGTERM"); } catch { /* empty */ }
  }

  // Escalate to SIGKILL after 2 seconds
  setTimeout(() => {
    try { process.kill(-pid, "SIGKILL"); } catch { /* empty */ }
    try { proc.kill("SIGKILL"); } catch { /* empty */ }
  }, 2000);
}

/** Shared signal for pausing stall detection (e.g. while awaiting user permission approval). */
export interface StallPauseSignal {
  paused: boolean;
}

export class AgentExecutor {
  async execute(args: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
    timeoutMs: number;
    stallTimeoutMs: number;
    onLine: (stream: "stdout" | "stderr", line: string) => void;
    signal: AbortSignal;
    onStdinReady?: (write: (data: string) => void) => void;
    stallPauseSignal?: StallPauseSignal;
  }): Promise<ExecuteResult> {
    let timedOut = false;
    let stalled = false;
    let lastActivity = Date.now();

    const proc = Bun.spawn([args.command, ...args.args], {
      cwd: args.cwd,
      env: args.env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: args.onStdinReady ? "pipe" : "ignore",
    });

    console.log(`[executor] spawned pid=${proc.pid} cmd=${args.command} timeout=${args.timeoutMs}ms stallTimeout=${args.stallTimeoutMs}ms`);

    // Expose stdin writer to caller
    if (args.onStdinReady && proc.stdin) {
      const writer = proc.stdin;
      args.onStdinReady((data: string) => {
        try {
          void writer.write(data);
          lastActivity = Date.now();
        } catch {
          // Process may have already exited
        }
      });
    }

    // Overall timeout
    const overallTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(proc, `timed out after ${args.timeoutMs}ms`);
    }, args.timeoutMs);

    // Stall detection
    let stallChecker: ReturnType<typeof setInterval> | undefined;
    if (args.stallTimeoutMs > 0) {
      stallChecker = setInterval(() => {
        // Skip stall check while paused (awaiting user permission approval)
        if (args.stallPauseSignal?.paused) return;
        if (Date.now() - lastActivity > args.stallTimeoutMs) {
          stalled = true;
          killProcessTree(proc, `stalled (no output for ${args.stallTimeoutMs}ms)`);
        }
      }, 10000);
    }

    // Cancellation
    const onAbort = () => {
      killProcessTree(proc, "aborted by user");
    };
    args.signal.addEventListener("abort", onAbort);

    await Promise.all([
      consumeStreamLines(proc.stdout, "stdout", {
        onChunk: () => {
          lastActivity = Date.now();
        },
        onLine: (stream, line) => {
          args.onLine(stream, line);
        },
      }),
      consumeStreamLines(proc.stderr, "stderr", {
        onChunk: () => {
          lastActivity = Date.now();
        },
        onLine: (stream, line) => {
          args.onLine(stream, line);
        },
      }),
    ]);

    const exitCode = await proc.exited;

    // Close stdin explicitly now that the process has exited
    if (args.onStdinReady) {
      try { void proc.stdin?.end(); } catch { /* already closed */ }
    }

    clearTimeout(overallTimer);
    if (stallChecker) clearInterval(stallChecker);
    args.signal.removeEventListener("abort", onAbort);

    console.log(`[executor] pid=${proc.pid} exited code=${exitCode} timedOut=${timedOut} stalled=${stalled}`);
    return { exitCode, timedOut, stalled };
  }
}
