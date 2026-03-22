import { describe, test, expect } from "bun:test";
import { AgentExecutor } from "./agent-executor";

describe("AgentExecutor", () => {
  const executor = new AgentExecutor();

  test("captures stdout lines and returns exit code 0", async () => {
    const lines: string[] = [];
    const result = await executor.execute({
      command: "echo",
      args: ["hello world"],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 10000,
      stallTimeoutMs: 5000,
      onLine: (stream, line) => lines.push(`${stream}:${line}`),
      signal: new AbortController().signal,
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stalled).toBe(false);
    expect(lines.some((l) => l.includes("hello world"))).toBe(true);
  });

  test("captures stderr", async () => {
    const lines: string[] = [];
    const result = await executor.execute({
      command: "sh",
      args: ["-c", "echo error >&2"],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 10000,
      stallTimeoutMs: 5000,
      onLine: (stream, line) => lines.push(`${stream}:${line}`),
      signal: new AbortController().signal,
    });

    expect(result.exitCode).toBe(0);
    expect(lines.some((l) => l.startsWith("stderr:") && l.includes("error"))).toBe(true);
  });

  test("returns non-zero exit code on failure", async () => {
    const result = await executor.execute({
      command: "sh",
      args: ["-c", "exit 42"],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 10000,
      stallTimeoutMs: 5000,
      onLine: () => {},
      signal: new AbortController().signal,
    });

    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  test("times out and kills process", async () => {
    const result = await executor.execute({
      command: "sleep",
      args: ["30"],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 500,
      stallTimeoutMs: 0, // disabled
      onLine: () => {},
      signal: new AbortController().signal,
    });

    expect(result.timedOut).toBe(true);
  });

  test("respects cancellation via abort signal", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);

    const result = await executor.execute({
      command: "sleep",
      args: ["30"],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 60000,
      stallTimeoutMs: 0,
      onLine: () => {},
      signal: ac.signal,
    });

    // Process should be killed
    expect(result.exitCode).not.toBe(0);
  });

  test("calls onStdinReady with a writer function", async () => {
    let stdinWriter: ((data: string) => void) | null = null;
    const lines: string[] = [];

    // Use cat to echo stdin back to stdout — it will read one line then exit
    const result = await executor.execute({
      command: "sh",
      args: ["-c", "read line; echo \"got:$line\""],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 10000,
      stallTimeoutMs: 5000,
      onLine: (_, line) => lines.push(line),
      signal: new AbortController().signal,
      onStdinReady: (write) => {
        stdinWriter = write;
        // Write immediately after stdin is ready
        write("hello\n");
      },
    });

    expect(stdinWriter).not.toBeNull();
    expect(result.exitCode).toBe(0);
    expect(lines.some((l) => l.includes("got:hello"))).toBe(true);
  });

  test("stallPauseSignal pauses stall detection", async () => {
    const stallPause = { paused: false };

    // Process that outputs once then goes silent for 2s
    // With a 500ms stall timeout it would normally be killed,
    // but we pause stall detection after the first line.
    const result = await executor.execute({
      command: "sh",
      args: ["-c", "echo start; sleep 2; echo done"],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 10000,
      stallTimeoutMs: 500,
      onLine: (_stream, line) => {
        if (line === "start") stallPause.paused = true;
        if (line === "done") stallPause.paused = false;
      },
      signal: new AbortController().signal,
      stallPauseSignal: stallPause,
    });

    // Should NOT have been killed by stall detection
    expect(result.exitCode).toBe(0);
    expect(result.stalled).toBe(false);
  });

  test("captures multiline output correctly", async () => {
    const lines: string[] = [];
    await executor.execute({
      command: "sh",
      args: ["-c", "echo line1; echo line2; echo line3"],
      env: { ...process.env } as Record<string, string>,
      cwd: "/tmp",
      timeoutMs: 10000,
      stallTimeoutMs: 5000,
      onLine: (_, line) => lines.push(line),
      signal: new AbortController().signal,
    });

    expect(lines).toContain("line1");
    expect(lines).toContain("line2");
    expect(lines).toContain("line3");
  });
});
