import type { ConvexClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { createServer, type Socket } from "net";
import { validateCommentBody } from "../../convex/lib/issueValidation";

/** Args that identify an issue by ID or simple ID */
interface IssueIdentifierArgs {
  issueId?: Id<"issues">;
  simpleId?: string;
}

interface CreateIssueArgs extends IssueIdentifierArgs {
  title: string;
  description?: string;
  status?: string;
  tags?: string[];
  autoMerge?: boolean;
}

interface UpdateIssueArgs extends IssueIdentifierArgs {
  title?: string;
  description?: string;
  tags?: string[];
  autoMerge?: boolean;
}

interface ListIssuesArgs {
  status?: string;
  tags?: string[];
  search?: string;
}

interface AddCommentArgs extends IssueIdentifierArgs {
  body: string;
}

interface BlockerArgs {
  issueId: Id<"issues">;
  blockedByIssueId: Id<"issues">;
}

/** Payload for `get_test_results` — null fields when no test run exists yet. */
interface TestResultsResponse {
  status: string | null;
  exitCode: number | null;
  error: string | null;
  logs: Array<{ stream: string; line: string; timestamp: number }>;
}

/** Configuration for an external MCP server to include alongside yes-kanban. */
export interface ExternalMcpConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * MCP Server for agent ↔ board integration.
 * Exposes tools for issue management, comments, and board context.
 *
 * Uses a TCP transport with a small stdio bridge script so Claude Code
 * can connect via its standard --mcp-config mechanism.
 */
export class McpServer {
  private server: ReturnType<typeof createServer> | null = null;
  private callCount = 0;
  private callCountResetTimer: ReturnType<typeof setInterval> | null = null;
  private readonly MAX_CALLS_PER_MINUTE = 60;
  private _runAttemptId: Id<"runAttempts"> | undefined;

  constructor(
    private convex: ConvexClient,
    private projectId: Id<"projects">,
    private workspaceId: Id<"workspaces">,
    private issueId: Id<"issues"> | undefined,
    private allowedTools: string[] | null,
    private externalMcpConfigs: ExternalMcpConfig[] = [],
    private disableBuiltIn: boolean = false,
  ) {}

  /** Update the runAttemptId so MCP tool calls are logged to the correct attempt. */
  setRunAttemptId(id: Id<"runAttempts">) {
    this._runAttemptId = id;
  }

  async start(): Promise<{ port: number; configPath: string }> {
    // Rate limiting reset
    this.callCountResetTimer = setInterval(() => {
      this.callCount = 0;
    }, 60000);

    return new Promise((resolve) => {
      this.server = createServer((socket) => {
        let buffer = "";
        socket.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              void this.handleMessage(line.trim(), socket);
            }
          }
        });
        socket.on("error", (err) => {
          console.warn(`[mcp-server] socket error: ${err.message}`);
        });
        socket.on("close", () => {
          buffer = "";
        });
      });

      this.server.on("error", (err) => {
        console.error(`[mcp-server] server error: ${err.message}`);
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server?.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;

        // Write a small bridge script that pipes stdio ↔ TCP.
        // This avoids depending on `node` — uses `bun` which is already available.
        const bridgeScriptPath = `/tmp/yes-kanban-mcp-bridge-${this.workspaceId}.ts`;
        const bridgeScript = `
import { createConnection } from "net";
const client = createConnection(${port}, "127.0.0.1");
process.stdin.pipe(client);
client.pipe(process.stdout);
client.on("error", () => process.exit(1));
`;

        // Write MCP config for the agent — merge external servers alongside yes-kanban
        const configPath = `/tmp/yes-kanban-mcp-${this.workspaceId}.json`;
        const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
        if (!this.disableBuiltIn) {
          mcpServers["yes-kanban"] = {
            command: "bun",
            args: ["run", bridgeScriptPath],
          };
        }
        for (const ext of this.externalMcpConfigs) {
          // Prevent overriding the built-in yes-kanban server
          if (ext.name === "yes-kanban") continue;
          const entry: { command: string; args: string[]; env?: Record<string, string> } = {
            command: ext.command,
            args: ext.args,
          };
          if (ext.env && Object.keys(ext.env).length > 0) {
            entry.env = ext.env;
          }
          mcpServers[ext.name] = entry;
        }
        const config = { mcpServers };

        void Promise.all([
          Bun.write(bridgeScriptPath, bridgeScript),
          Bun.write(configPath, JSON.stringify(config, null, 2)),
        ]).then(() => resolve({ port, configPath }));
      });
    });
  }

  stop() {
    if (this.callCountResetTimer) {
      clearInterval(this.callCountResetTimer);
    }
    if (this.server) {
      this.server.close();
    }
    // Clean up temp files
    for (const f of [
      `/tmp/yes-kanban-mcp-${this.workspaceId}.json`,
      `/tmp/yes-kanban-mcp-bridge-${this.workspaceId}.ts`,
      `/tmp/yes-kanban-settings-${this.workspaceId}.json`,
    ]) {
      try { Bun.spawnSync(["rm", "-f", f]); } catch { /* ignore */ }
    }
  }

  private safeWrite(socket: Socket, data: string): void {
    if (!socket.writable) return;
    try {
      socket.write(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp-server] failed to write to socket: ${msg}`);
    }
  }

  private async handleMessage(message: string, socket: Socket) {
    let requestId: unknown = null;
    try {
      const request = JSON.parse(message);
      requestId = request.id ?? null;

      // MCP notifications have no id — do not send a response
      if (request.id === undefined || request.id === null) {
        return;
      }

      if (request.method === "initialize") {
        this.safeWrite(socket, JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "yes-kanban", version: "0.1.0" },
          },
        }) + "\n");
        return;
      }

      if (request.method === "tools/list") {
        this.safeWrite(socket, JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: this.getToolDefinitions() },
        }) + "\n");
        return;
      }

      if (request.method === "tools/call") {
        const result = await this.handleToolCall(request.params.name, request.params.arguments ?? {});
        this.safeWrite(socket, JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        }) + "\n");
        return;
      }

      // Respond to unknown methods
      this.safeWrite(socket, JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Method not found" },
      }) + "\n");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.safeWrite(socket, JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        error: { code: requestId !== null ? -32603 : -32700, message: errMsg },
      }) + "\n");
    }
  }

  private async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Check allowlist
    if (this.allowedTools && !this.allowedTools.includes(name)) {
      throw new Error(`Tool "${name}" is not allowed for this agent`);
    }

    // Rate limit
    this.callCount++;
    if (this.callCount > this.MAX_CALLS_PER_MINUTE) {
      throw new Error("Rate limit exceeded: max 60 calls per minute per workspace");
    }

    // Log tool call
    if (this._runAttemptId) {
      await this.convex.mutation(api.agentLogs.append, {
        runAttemptId: this._runAttemptId,
        workspaceId: this.workspaceId,
        stream: "stdout",
        line: `[MCP] ${name}(${JSON.stringify(args)})`,
        structured: { type: "mcp_tool_call", tool: name, args },
      });
    }

    switch (name) {
      case "create_issue":
        return this.createIssue(args as unknown as CreateIssueArgs);
      case "update_issue":
        return this.updateIssue(args as unknown as UpdateIssueArgs);
      case "delete_issue":
        return this.deleteIssue(args as unknown as IssueIdentifierArgs);
      case "get_issue":
        return this.getIssue(args as unknown as IssueIdentifierArgs);
      case "list_issues":
        return this.listIssues(args as unknown as ListIssuesArgs);
      case "add_comment":
        return this.addComment(args as unknown as AddCommentArgs);
      case "list_comments":
        return this.listComments(args as unknown as IssueIdentifierArgs);
      case "add_blocker":
        return this.addBlocker(args as unknown as BlockerArgs);
      case "remove_blocker":
        return this.removeBlocker(args as unknown as BlockerArgs);
      case "list_attachments":
        return this.listAttachments(args as unknown as IssueIdentifierArgs);
      case "get_current_issue":
        return this.getCurrentIssue();
      case "get_project_columns":
        return this.getProjectColumns();
      case "get_workspace_info":
        return this.getWorkspaceInfo();
      case "ask_question":
        return this.askQuestion(args as { question: string; suggestedAnswers?: string[] });
      case "submit_plan":
        return this.submitPlan(args as { plan: string });
      case "get_plan":
        return this.getPlan();
      case "get_feedback":
        return this.getFeedback();
      case "get_test_results":
        return this.getTestResults();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async resolveIssueId(args: IssueIdentifierArgs): Promise<Id<"issues">> {
    if (args.issueId) return args.issueId;
    if (args.simpleId) {
      const issue = await this.convex.query(api.issues.getBySimpleId, {
        projectId: this.projectId,
        simpleId: args.simpleId,
      });
      if (!issue) throw new Error(`Issue ${args.simpleId} not found`);
      return issue._id;
    }
    throw new Error("Either issueId or simpleId is required");
  }

  private async createIssue(args: CreateIssueArgs) {
    const id = await this.convex.mutation(api.issues.create, {
      projectId: this.projectId,
      title: args.title,
      description: args.description ?? "",
      status: args.status ?? "To Do",
      tags: args.tags ?? [],
      autoMerge: args.autoMerge,
      actor: "agent",
    });
    const issue = await this.convex.query(api.issues.get, { id });
    return { issueId: id, simpleId: issue?.simpleId };
  }

  private async updateIssue(args: UpdateIssueArgs) {
    const id = await this.resolveIssueId(args);
    await this.convex.mutation(api.issues.update, {
      id,
      title: args.title,
      description: args.description,
      tags: args.tags,
      autoMerge: args.autoMerge,
      actor: "agent",
    });
    return { updated: true };
  }

  private async deleteIssue(args: IssueIdentifierArgs) {
    const id = await this.resolveIssueId(args);
    await this.convex.mutation(api.issues.remove, { id });
    return { deleted: true };
  }

  private async getIssue(args: IssueIdentifierArgs) {
    const id = await this.resolveIssueId(args);
    return await this.convex.query(api.issues.get, { id });
  }

  private async listIssues(args: ListIssuesArgs) {
    return await this.convex.query(api.issues.list, {
      projectId: this.projectId,
      status: args.status,
      tags: args.tags,
      search: args.search,
    });
  }

  private async addComment(args: AddCommentArgs) {
    validateCommentBody(args.body);
    const id = await this.resolveIssueId(args);
    const commentId = await this.convex.mutation(api.comments.create, {
      issueId: id,
      body: args.body,
      author: "agent",
      runAttemptId: this._runAttemptId,
    });
    return { commentId };
  }

  private async listComments(args: IssueIdentifierArgs) {
    const id = await this.resolveIssueId(args);
    return await this.convex.query(api.comments.list, { issueId: id });
  }

  private async addBlocker(args: BlockerArgs) {
    const issue = await this.convex.query(api.issues.get, { id: args.issueId });
    if (!issue) throw new Error("Issue not found");
    const existing = issue.blockedBy ?? [];
    if (existing.includes(args.blockedByIssueId)) {
      return { updated: false, reason: "Blocker already exists" };
    }
    const blockers = [...existing, args.blockedByIssueId];
    await this.convex.mutation(api.issues.update, {
      id: args.issueId,
      blockedBy: blockers,
      actor: "agent",
    });
    return { updated: true };
  }

  private async removeBlocker(args: BlockerArgs) {
    const issue = await this.convex.query(api.issues.get, { id: args.issueId });
    if (!issue) throw new Error("Issue not found");
    const blockers = (issue.blockedBy ?? []).filter(
      (b) => b !== args.blockedByIssueId
    );
    await this.convex.mutation(api.issues.update, {
      id: args.issueId,
      blockedBy: blockers,
      actor: "agent",
    });
    return { updated: true };
  }

  private async resolveIssueIdWithFallback(args: IssueIdentifierArgs): Promise<Id<"issues">> {
    if (args.issueId || args.simpleId) return this.resolveIssueId(args);
    if (this.issueId) return this.issueId;
    throw new Error("Either issueId or simpleId is required");
  }

  private async listAttachments(args: IssueIdentifierArgs) {
    const id = await this.resolveIssueIdWithFallback(args).catch(() => null);
    if (!id) return [];
    return await this.convex.query(api.attachments.list, { issueId: id });
  }

  private async getCurrentIssue() {
    if (!this.issueId) return null;
    return await this.convex.query(api.issues.get, { id: this.issueId });
  }

  private async getProjectColumns() {
    return await this.convex.query(api.columns.list, { projectId: this.projectId });
  }

  private async getWorkspaceInfo() {
    return await this.convex.query(api.workspaces.get, { id: this.workspaceId });
  }

  private async askQuestion(args: { question: string; suggestedAnswers?: string[] }) {
    // ask_question is allowed during planning and coding phases
    const ws = await this.convex.query(api.workspaces.get, { id: this.workspaceId });
    if (ws && !["planning", "grilling", "coding"].includes(ws.status)) {
      throw new Error(`ask_question is not available during "${ws.status}" phase`);
    }
    const id = await this.convex.mutation(api.agentQuestions.create, {
      workspaceId: this.workspaceId,
      question: args.question,
      suggestedAnswers: args.suggestedAnswers,
    });
    return { questionId: id, status: "pending" };
  }

  private async submitPlan(args: { plan: string }) {
    // submit_plan is only valid during the planning phase
    const ws = await this.convex.query(api.workspaces.get, { id: this.workspaceId });
    if (ws && ws.status !== "planning") {
      throw new Error(`submit_plan is only available during "planning" phase, current: "${ws.status}"`);
    }
    await this.convex.mutation(api.workspaces.updatePlan, {
      id: this.workspaceId,
      plan: args.plan,
    });
    return { submitted: true };
  }

  private async getPlan() {
    const workspace = await this.convex.query(api.workspaces.get, { id: this.workspaceId });
    return { plan: workspace?.plan ?? null, approved: workspace?.planApproved ?? false };
  }

  private async getFeedback() {
    const pending = await this.convex.query(api.feedbackMessages.listPending, {
      workspaceId: this.workspaceId,
    });
    // Mark as delivered
    if (pending.length > 0) {
      await this.convex.mutation(api.feedbackMessages.markBatchDelivered, {
        ids: pending.map((m) => m._id),
      });
    }
    return { messages: pending.map((m) => ({ id: m._id, body: m.body, author: m.author, createdAt: m.createdAt })) };
  }

  private async getTestResults(): Promise<TestResultsResponse> {
    const attempt = await this.convex.query(api.runAttempts.lastByType, {
      workspaceId: this.workspaceId,
      type: "test",
    });
    if (!attempt) {
      return { status: null, exitCode: null, error: null, logs: [] };
    }
    const logs = await this.convex.query(api.agentLogs.list, { runAttemptId: attempt._id });
    return {
      status: attempt.status,
      exitCode: attempt.exitCode ?? null,
      error: attempt.error ?? null,
      logs: logs.map((l) => ({ stream: l.stream, line: l.line, timestamp: l.timestamp })),
    };
  }

  private getToolDefinitions() {
    const allTools = [
      {
        name: "create_issue",
        description:
          "Create a new issue in the project. Use status 'Backlog' for follow-up items discovered during implementation.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Issue title" },
            description: { type: "string", description: "Issue description (Markdown)" },
            status: { type: "string", description: "Column/status name" },
            tags: { type: "array", items: { type: "string" } },
            autoMerge: { type: "boolean", description: "Auto-merge after passing review" },
          },
          required: ["title"],
        },
      },
      {
        name: "update_issue",
        description: "Update an existing issue",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            simpleId: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            autoMerge: { type: "boolean", description: "Auto-merge after passing review" },
          },
        },
      },
      {
        name: "delete_issue",
        description: "Delete an issue",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            simpleId: { type: "string" },
          },
        },
      },
      {
        name: "get_issue",
        description: "Get full details of an issue",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            simpleId: { type: "string" },
          },
        },
      },
      {
        name: "list_issues",
        description: "List issues with optional filters",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            search: { type: "string" },
          },
        },
      },
      {
        name: "add_comment",
        description: "Add a comment to an issue",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            simpleId: { type: "string" },
            body: { type: "string", description: "Comment body (Markdown)" },
          },
          required: ["body"],
        },
      },
      {
        name: "list_comments",
        description: "List comments on an issue",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            simpleId: { type: "string" },
          },
        },
      },
      {
        name: "add_blocker",
        description: "Mark an issue as blocked by another",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            blockedByIssueId: { type: "string" },
          },
          required: ["issueId", "blockedByIssueId"],
        },
      },
      {
        name: "remove_blocker",
        description: "Remove a blocker relationship",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            blockedByIssueId: { type: "string" },
          },
          required: ["issueId", "blockedByIssueId"],
        },
      },
      {
        name: "list_attachments",
        description: "List attachments on an issue with download URLs. Defaults to the current workspace issue.",
        inputSchema: {
          type: "object",
          properties: {
            issueId: { type: "string" },
            simpleId: { type: "string" },
          },
        },
      },
      {
        name: "get_current_issue",
        description: "Get the issue associated with the current workspace",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_project_columns",
        description: "List the project's board columns",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_workspace_info",
        description: "Get details about the current workspace",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "ask_question",
        description: "Ask the user a question and wait for their answer. Use this during planning to gather requirements or clarify ambiguities. You MUST always provide exactly 3 suggested answers that the user can pick from.",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question to ask the user" },
            suggestedAnswers: {
              type: "array",
              items: { type: "string" },
              description: "Exactly 3 suggested answers the user can pick from",
              minItems: 3,
              maxItems: 3,
            },
          },
          required: ["question", "suggestedAnswers"],
        },
      },
      {
        name: "submit_plan",
        description: "Submit an implementation plan for user review. The plan should be a structured markdown document describing the approach, key decisions, and steps.",
        inputSchema: {
          type: "object",
          properties: {
            plan: { type: "string", description: "The implementation plan (Markdown)" },
          },
          required: ["plan"],
        },
      },
      {
        name: "get_plan",
        description: "Get the current implementation plan and its approval status",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_feedback",
        description: "Check for any pending feedback messages from the user. Returns and marks as delivered any unread messages.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_test_results",
        description: "Get the output from the most recent test run",
        inputSchema: { type: "object", properties: {} },
      },
    ];

    if (this.allowedTools) {
      return allTools.filter((t) => this.allowedTools?.includes(t.name));
    }
    return allTools;
  }
}
