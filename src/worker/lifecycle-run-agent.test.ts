import { describe, test, expect, mock } from "bun:test";
import { runAgent, extractReviewVerdict, extractPlanReviewVerdict, extractAssistantText } from "./lifecycle";

describe("runAgent", () => {
  const mockConvex = () => ({
    mutation: mock((..._args: any[]) => "runAttemptId"),
  });

  const baseConfig = { stallTimeoutMs: 300000 } as any;

  const baseAgentConfig = {
    _id: "configId",
    agentType: "claude-code",
    command: "echo",
    args: [],
    model: undefined,
    timeoutMs: 3600000,
    env: {},
    mcpEnabled: false,
  } as any;

  const makeExecutor = (result: { exitCode: number; timedOut?: boolean; stalled?: boolean }) => ({
    execute: mock((args: any) => {
      args.onLine("stdout", "Working...");
      args.onLine("stdout", "Done!");
      return Promise.resolve({
        exitCode: result.exitCode,
        timedOut: result.timedOut ?? false,
        stalled: result.stalled ?? false,
      });
    }),
  });

  test("returns success true on exit code 0", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    const result = await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Fix bug", "coding",
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.events).toBeInstanceOf(Array);
  });

  test("returns success false on non-zero exit code", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 1 });

    const result = await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Fix bug", "coding",
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("creates a run attempt via mutation", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Fix bug", "coding",
      new AbortController().signal,
    );

    // First mutation call should be runAttempts.create
    const firstCall = convex.mutation.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall![1]).toMatchObject({
      workspaceId: "wsId",
      type: "coding",
      prompt: "Fix bug",
    });
  });

  test("passes GIT_EDITOR and GIT_MERGE_AUTOEDIT to executor so git rebase does not open an editor (YES-209)", async () => {
    const convex = mockConvex();
    const executeMock = mock((args: any) => {
      args.onLine("stdout", "Working...");
      return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
    });
    const executor = { execute: executeMock };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Fix bug", "coding",
      new AbortController().signal,
    );

    expect(executeMock.mock.calls.length).toBe(1);
    const env = executeMock.mock.calls[0]![0].env as Record<string, string>;
    expect(env["GIT_EDITOR"]).toBe("true");
    expect(env["GIT_MERGE_AUTOEDIT"]).toBe("no");
  });

  test("overrides GIT_EDITOR from agent config when set (YES-209)", async () => {
    const convex = mockConvex();
    const executeMock = mock((args: any) => {
      args.onLine("stdout", "Working...");
      return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
    });
    const executor = { execute: executeMock };
    const configWithEditor = {
      ...baseAgentConfig,
      env: { GIT_EDITOR: "vim", GIT_MERGE_AUTOEDIT: "yes" },
    };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      configWithEditor, "/tmp/cwd", "Fix bug", "coding",
      new AbortController().signal,
    );

    const env = executeMock.mock.calls[0]![0].env as Record<string, string>;
    expect(env["GIT_EDITOR"]).toBe("true");
    expect(env["GIT_MERGE_AUTOEDIT"]).toBe("no");
  });

  test("throws before runAttempts.create when agentType is unsupported (e.g. legacy pi)", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });
    const badConfig = { ...baseAgentConfig, agentType: "pi" };

    let err: unknown;
    try {
      await runAgent(
        convex as any, baseConfig, executor as any, "wsId" as any,
        badConfig, "/tmp/cwd", "Fix bug", "coding",
        new AbortController().signal,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(String(err)).toMatch(/Unsupported agent type: pi/);
    expect(convex.mutation.mock.calls.length).toBe(0);
  });

  test("completes run attempt with succeeded on exit 0", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
    );

    const completeCalls = convex.mutation.mock.calls.filter((c: any[]) =>
      c[1] && "status" in c[1] && c[1].status === "succeeded"
    );
    expect(completeCalls.length).toBe(1);
  });

  test("completes run attempt with failed on non-zero exit", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 1 });

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
    );

    const completeCalls = convex.mutation.mock.calls.filter((c: any[]) =>
      c[1]?.status === "failed"
    );
    expect(completeCalls.length).toBe(1);
  });

  test("completes with timed_out when executor times out", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 1, timedOut: true });

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
    );

    const completeCalls = convex.mutation.mock.calls.filter((c: any[]) =>
      c[1]?.status === "timed_out"
    );
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0]![1].error).toContain("timed out");
  });

  test("captures lastOutput as last line received", async () => {
    const convex = mockConvex();
    const executor = {
      execute: mock((args: any) => {
        args.onLine("stdout", "Line 1");
        args.onLine("stdout", "Line 2");
        args.onLine("stdout", "Final line");
        return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
      }),
    };

    const result = await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
    );

    expect(result.lastOutput).toBe("Final line");
  });

  test("accumulates structured events from parsed output", async () => {
    const convex = mockConvex();
    const executor = {
      execute: mock((args: any) => {
        args.onLine("stdout", JSON.stringify({ type: "assistant", content: "Hello" }));
        args.onLine("stdout", JSON.stringify({ type: "result", session_id: "sess_123", usage: { input_tokens: 100, output_tokens: 50 } }));
        return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
      }),
    };

    const result = await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
    );

    expect(result.events.length).toBe(2);
    expect(result.events[0]!.type).toBe("assistant_message");
    expect(result.events[1]!.type).toBe("completion");
    expect(result.sessionId).toBe("sess_123");
  });

  test("enriches Codex system init with model and permissionMode from run context (E2E--183)", async () => {
    const convex = mockConvex();
    const codexConfig = {
      ...baseAgentConfig,
      agentType: "codex",
      model: "gpt-4.1",
    };
    const executor = {
      execute: mock((args: any) => {
        args.onLine("stdout", JSON.stringify({ type: "thread.started" }));
        return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
      }),
    };

    const result = await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      codexConfig, "/tmp/cwd", "Task", "review",
      new AbortController().signal,
      { permissionMode: "plan" },
    );

    expect(result.events.length).toBe(1);
    expect(result.events[0]!.type).toBe("system");
    const data = result.events[0]!.data as Record<string, unknown>;
    expect(data["subtype"]).toBe("init");
    expect(data["model"]).toBe("gpt-4.1");
    expect(data["permissionMode"]).toBe("plan");
  });

  test("includes last stderr lines in error message on failure", async () => {
    const convex = mockConvex();
    const executor = {
      execute: mock((args: any) => {
        args.onLine("stdout", "some stdout");
        args.onLine("stderr", "Error: API key not found");
        args.onLine("stderr", "Authentication failed");
        return Promise.resolve({ exitCode: 1, timedOut: false, stalled: false });
      }),
    };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
    );

    const completeCalls = convex.mutation.mock.calls.filter((c: any[]) =>
      c[1]?.status === "failed"
    );
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0]![1].error).toContain("Authentication failed");
  });

  test("accept mode passes onStdinReady and stallPauseSignal to executor", async () => {
    const convex = mockConvex();
    const executor = {
      execute: mock((args: any) => {
        // Verify accept-mode-specific args are passed
        expect(args.onStdinReady).toBeDefined();
        expect(args.stallPauseSignal).toBeDefined();
        expect(args.stallPauseSignal.paused).toBe(false);
        return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
      }),
    };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
      { permissionMode: "accept" },
    );

    expect(executor.execute).toHaveBeenCalled();
  });

  test("accept mode expires pending requests on cleanup", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
      { permissionMode: "accept" },
    );

    // Should have called expirePending mutation
    const expireCalls = convex.mutation.mock.calls.filter((c: any[]) =>
      c[1] && "runAttemptId" in c[1] && !("status" in c[1]) && !("type" in c[1])
    );
    expect(expireCalls.length).toBe(1);
  });

  test("non-accept mode does not pass stdin/stall args to executor", async () => {
    const convex = mockConvex();
    const executor = {
      execute: mock((args: any) => {
        expect(args.onStdinReady).toBeUndefined();
        expect(args.stallPauseSignal).toBeUndefined();
        return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
      }),
    };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
    );

    expect(executor.execute).toHaveBeenCalled();
  });

  test("accept mode creates permission request and pauses stall on permission_request event", async () => {
    const convex = mockConvex();
    // Also mock query for the polling
    (convex as any).query = mock(() => ({ status: "approved", requestId: "req_1" }));

    const executor = {
      execute: mock((args: any) => {
        // Emit a permission_request event
        args.onLine("stdout", JSON.stringify({
          type: "permission_request",
          request_id: "req_1",
          tool: { name: "Bash", input: { command: "ls" } },
        }));

        // Stall should be paused after permission request
        expect(args.stallPauseSignal.paused).toBe(true);

        // Provide stdin writer
        if (args.onStdinReady) {
          args.onStdinReady((_data: string) => {});
        }

        return Promise.resolve({ exitCode: 0, timedOut: false, stalled: false });
      }),
    };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
      { permissionMode: "accept" },
    );

    // Verify permission request was created via mutation
    const createCalls = convex.mutation.mock.calls.filter((c: any[]) =>
      c[1] && "toolName" in c[1] && c[1].toolName === "Bash"
    );
    expect(createCalls.length).toBe(1);
    expect(createCalls[0]![1].requestId).toBe("req_1");
  });

  test("accept mode always_allowed response persists tool pattern to agentConfig", async () => {
    const convex = mockConvex();
    // Mock query to return always_allowed status
    (convex as any).query = mock(() => ({ status: "always_allowed", requestId: "req_1" }));

    let stdinWritten = "";
    const executor = {
      execute: mock((args: any) => {
        // Provide stdin writer first so polling can proceed
        if (args.onStdinReady) {
          args.onStdinReady((data: string) => { stdinWritten += data; });
        }

        // Emit a permission_request event
        args.onLine("stdout", JSON.stringify({
          type: "permission_request",
          request_id: "req_1",
          tool: { name: "Bash", input: { command: "ls" } },
        }));

        // Let the setTimeout-based poller run
        return new Promise((resolve) => {
          setTimeout(() => resolve({ exitCode: 0, timedOut: false, stalled: false }), 1500);
        });
      }),
    };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
      { permissionMode: "accept", agentConfigId: "configId" as any },
    );

    // Verify addAllowedTool was called with the tool name
    const addToolCalls = convex.mutation.mock.calls.filter((c: any[]) =>
      c[1] && "toolPattern" in c[1]
    );
    expect(addToolCalls.length).toBe(1);
    expect(addToolCalls[0]![1].toolPattern).toBe("Bash");

    // Verify stdin received the approved response
    expect(stdinWritten).toContain('"approved":true');
  });

  test("sets MCP server runAttemptId when provided", async () => {
    const convex = mockConvex();
    const executor = makeExecutor({ exitCode: 0 });
    const mockMcpServer = { setRunAttemptId: mock(() => {}) };

    await runAgent(
      convex as any, baseConfig, executor as any, "wsId" as any,
      baseAgentConfig, "/tmp/cwd", "Task", "coding",
      new AbortController().signal,
      { mcpServer: mockMcpServer as any },
    );

    expect(mockMcpServer.setRunAttemptId).toHaveBeenCalledWith("runAttemptId");
  });
});

describe("extractReviewVerdict", () => {
  // Helper to build events matching the real Claude Code adapter output shape
  function adapterEvent(text: string) {
    return {
      type: "assistant_message" as const,
      data: { type: "assistant", message: { content: [{ type: "text", text }] } },
    };
  }

  test("returns APPROVE when found on first line", () => {
    const events = [adapterEvent("APPROVE\n\nThe code looks good.")];
    expect(extractReviewVerdict(events)).toBe("APPROVE");
  });

  test("returns REQUEST_CHANGES when found on first line", () => {
    const events = [adapterEvent("REQUEST_CHANGES: fix the tests\n\nDetails here")];
    expect(extractReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("returns CONCERN when found on first line", () => {
    const events = [adapterEvent("CONCERN\n\nPotential issue with edge case")];
    expect(extractReviewVerdict(events)).toBe("CONCERN");
  });

  test("returns UNKNOWN when no verdict found", () => {
    const events = [adapterEvent("Hmm, interesting code")];
    expect(extractReviewVerdict(events)).toBe("UNKNOWN");
  });

  test("does not match verdict keywords in explanation text", () => {
    const events = [adapterEvent("APPROVE\n\nThe severity-based verdict model (REQUEST_CHANGES > CONCERN > APPROVE) is safer")];
    expect(extractReviewVerdict(events)).toBe("APPROVE");
  });

  test("returns CONCERN when found in assistant message", () => {
    const events = [adapterEvent("CONCERN: there may be a race condition here")];
    expect(extractReviewVerdict(events)).toBe("CONCERN");
  });

  test("prefers REQUEST_CHANGES over CONCERN", () => {
    const events = [adapterEvent("CONCERN noted but REQUEST_CHANGES required")];
    expect(extractReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("APPROVE takes precedence over CONCERN (non-blocking)", () => {
    const events = [adapterEvent("APPROVE overall but CONCERN about edge case")];
    expect(extractReviewVerdict(events)).toBe("APPROVE");
  });

  test("prefers REQUEST_CHANGES over APPROVE in same message", () => {
    const events = [adapterEvent("I would APPROVE but REQUEST_CHANGES needed")];
    expect(extractReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("uses highest severity across multiple messages", () => {
    const events = [
      adapterEvent("REQUEST_CHANGES needed"),
      { type: "tool_use" as const, data: {} },
      adapterEvent("APPROVE\n\nAfter review, looks good"),
    ];
    expect(extractReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("APPROVE in later message wins over CONCERN in earlier message", () => {
    const events = [
      adapterEvent("CONCERN: potential race condition"),
      adapterEvent("Overall looks good, APPROVE"),
    ];
    expect(extractReviewVerdict(events)).toBe("APPROVE");
  });

  test("FINAL_VERDICT line takes precedence over bare keywords", () => {
    const events = [adapterEvent("APPROVE\n\nThe code looks good but...\n\nCONCERN about tests\n\nFINAL_VERDICT: APPROVE")];
    expect(extractReviewVerdict(events)).toBe("APPROVE");
  });

  test("FINAL_VERDICT REQUEST_CHANGES overrides APPROVE in text", () => {
    const events = [adapterEvent("APPROVE overall but needs fixes\n\nFINAL_VERDICT: REQUEST_CHANGES — missing tests")];
    expect(extractReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("FINAL_VERDICT CONCERN is respected", () => {
    const events = [adapterEvent("Review done\n\nFINAL_VERDICT: CONCERN — edge case not covered")];
    expect(extractReviewVerdict(events)).toBe("CONCERN");
  });

  test("works with simple content string format", () => {
    const events = [
      { type: "assistant_message" as const, data: { content: "APPROVE" } },
    ];
    expect(extractReviewVerdict(events)).toBe("APPROVE");
  });
});

describe("extractPlanReviewVerdict", () => {
  function adapterEvent(text: string) {
    return {
      type: "assistant_message" as const,
      data: { type: "assistant", message: { content: [{ type: "text", text }] } },
    };
  }

  test("returns APPROVE when found on first line", () => {
    const events = [adapterEvent("APPROVE\n\nThe plan looks solid.")];
    expect(extractPlanReviewVerdict(events)).toBe("APPROVE");
  });

  test("returns REQUEST_CHANGES when found on first line", () => {
    const events = [adapterEvent("REQUEST_CHANGES: missing testing strategy\n\nDetails")];
    expect(extractPlanReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("returns RESTART when found on first line", () => {
    const events = [adapterEvent("RESTART\n\nThis plan is fundamentally flawed")];
    expect(extractPlanReviewVerdict(events)).toBe("RESTART");
  });

  test("returns UNKNOWN when no verdict found", () => {
    const events = [adapterEvent("This plan needs some work")];
    expect(extractPlanReviewVerdict(events)).toBe("UNKNOWN");
  });

  test("prefers RESTART over REQUEST_CHANGES", () => {
    const events = [adapterEvent("REQUEST_CHANGES but actually RESTART")];
    expect(extractPlanReviewVerdict(events)).toBe("RESTART");
  });

  test("prefers REQUEST_CHANGES over APPROVE", () => {
    const events = [adapterEvent("APPROVE mostly but REQUEST_CHANGES needed")];
    expect(extractPlanReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("uses highest severity across multiple messages", () => {
    const events = [
      adapterEvent("APPROVE"),
      adapterEvent("REQUEST_CHANGES needed after further review"),
    ];
    expect(extractPlanReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("FINAL_VERDICT line takes precedence (YES-250 clarification response)", () => {
    const events = [
      adapterEvent(
        "The plan is thorough but missing edge cases.\n\nFINAL_VERDICT: REQUEST_CHANGES — add error handling",
      ),
    ];
    expect(extractPlanReviewVerdict(events)).toBe("REQUEST_CHANGES");
  });

  test("FINAL_VERDICT APPROVE at end overrides ambiguous first line (YES-250)", () => {
    const events = [
      adapterEvent(
        "REQUEST_CHANGES might be needed for section 3\n\nAfter reconsidering, the plan is acceptable.\n\nFINAL_VERDICT: APPROVE",
      ),
    ];
    expect(extractPlanReviewVerdict(events)).toBe("APPROVE");
  });

  test("FINAL_VERDICT RESTART is respected (YES-250)", () => {
    const events = [
      adapterEvent("Wrong scope entirely.\n\nFINAL_VERDICT: RESTART — wrong issue"),
    ];
    expect(extractPlanReviewVerdict(events)).toBe("RESTART");
  });
});

describe("extractAssistantText", () => {
  function adapterEvent(text: string) {
    return {
      type: "assistant_message" as const,
      data: { type: "assistant", message: { content: [{ type: "text", text }] } },
    };
  }

  test("concatenates all assistant messages", () => {
    const events = [
      adapterEvent("First"),
      { type: "tool_use" as const, data: {} },
      adapterEvent("Second"),
    ];
    expect(extractAssistantText(events)).toBe("First\nSecond");
  });

  test("handles content block arrays", () => {
    const events = [
      { type: "assistant_message" as const, data: { content: [{ type: "text", text: "Block 1" }, { type: "text", text: "Block 2" }] } },
    ];
    expect(extractAssistantText(events)).toBe("Block 1\nBlock 2");
  });

  test("handles adapter-shaped nested message content", () => {
    const events = [
      adapterEvent("Review feedback here"),
    ];
    expect(extractAssistantText(events)).toBe("Review feedback here");
  });
});
