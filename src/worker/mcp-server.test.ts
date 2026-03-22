import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import { McpServer } from "./mcp-server";
import { createConnection } from "net";

function sendJsonRpc(port: number, method: string, params?: any, id?: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = createConnection({ port }, () => {
      const msg = JSON.stringify({ jsonrpc: "2.0", method, params, id: id ?? 1 });
      client.write(msg + "\n");
    });
    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString();
      // MCP protocol uses newline-delimited JSON — resolve on first complete line
      const newlineIdx = data.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = data.slice(0, newlineIdx).trim();
        client.destroy();
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve(line);
        }
      }
    });
    client.on("error", (err) => {
      if (data) {
        try { resolve(JSON.parse(data.trim())); } catch { resolve(data); }
      } else {
        reject(err);
      }
    });
    setTimeout(() => { client.destroy(); reject(new Error("timeout")); }, 3000);
  });
}

describe("McpServer", () => {
  let server: McpServer;
  let port: number;
  const mockConvex = {
    query: mock((..._args: any[]) => null),
    mutation: mock((..._args: any[]) => "mockId"),
  };

  beforeAll(async () => {
    server = new McpServer(
      mockConvex as any,
      "projectId" as any,
      "workspaceId" as any,
      undefined,
      null,
    );
    const result = await server.start();
    port = result.port;
  });

  afterAll(() => {
    server.stop();
  });

  test("starts and returns port and configPath", () => {
    expect(port).toBeGreaterThan(0);
  });

  test("initialize returns protocol version", async () => {
    const response = await sendJsonRpc(port, "initialize", {});
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("yes-kanban");
  });

  test("tools/list returns all 21 tools when no allowlist", async () => {
    const response = await sendJsonRpc(port, "tools/list", {});
    expect(response.result.tools.length).toBe(21);
    const names = response.result.tools.map((t: any) => t.name);
    expect(names).toContain("create_issue");
    expect(names).toContain("list_attachments");
    expect(names).toContain("get_current_issue");
    expect(names).toContain("get_workspace_info");
    expect(names).toContain("ask_question");
    expect(names).toContain("submit_plan");
    expect(names).toContain("get_plan");
    expect(names).toContain("get_feedback");
  });

  test("create_issue tool schema includes autoMerge property", async () => {
    const response = await sendJsonRpc(port, "tools/list", {});
    const createTool = response.result.tools.find((t: any) => t.name === "create_issue");
    expect(createTool.inputSchema.properties.autoMerge).toEqual({
      type: "boolean",
      description: "Auto-merge after passing review",
    });
  });

  test("update_issue tool schema includes autoMerge property", async () => {
    const response = await sendJsonRpc(port, "tools/list", {});
    const updateTool = response.result.tools.find((t: any) => t.name === "update_issue");
    expect(updateTool.inputSchema.properties.autoMerge).toEqual({
      type: "boolean",
      description: "Auto-merge after passing review",
    });
  });

  test("create_issue passes autoMerge to mutation", async () => {
    mockConvex.mutation.mockReturnValue("issueId" as any);
    mockConvex.query.mockReturnValue({ simpleId: "TEST-1" } as any);
    await sendJsonRpc(port, "tools/call", {
      name: "create_issue",
      arguments: { title: "Test", autoMerge: true },
    });
    const createCall = mockConvex.mutation.mock.calls.find(
      (c: any[]) => c[1]?.title === "Test"
    );
    expect(createCall).toBeDefined();
    expect(createCall![1].autoMerge).toBe(true);
  });

  test("unknown method returns error code -32601", async () => {
    const response = await sendJsonRpc(port, "unknown/method", {});
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toBe("Method not found");
  });

  test("invalid JSON returns parse error", async () => {
    const response = await new Promise<any>((resolve, reject) => {
      const client = createConnection({ port }, () => {
        client.write("not valid json\n");
      });
      let data = "";
      client.on("data", (chunk) => {
        data += chunk.toString();
        const newlineIdx = data.indexOf("\n");
        if (newlineIdx !== -1) {
          const line = data.slice(0, newlineIdx).trim();
          client.destroy();
          try { resolve(JSON.parse(line)); } catch { resolve(line); }
        }
      });
      client.on("error", (err) => {
        if (data) {
          try { resolve(JSON.parse(data.trim())); } catch { resolve(data); }
        } else { reject(err); }
      });
      setTimeout(() => { client.destroy(); reject(new Error("timeout")); }, 3000);
    });
    expect(response.error.code).toBe(-32700);
    expect(response.id).toBeNull();
  });

  test("post-parse error preserves request ID and uses -32603", async () => {
    const response = await sendJsonRpc(port, "tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    }, 42);
    expect(response.id).toBe(42);
    expect(response.error.code).toBe(-32603);
  });

  test("list_attachments returns empty array when no issueId", async () => {
    const response = await sendJsonRpc(port, "tools/call", {
      name: "list_attachments",
      arguments: {},
    });
    const result = JSON.parse(response.result.content[0].text);
    expect(result).toEqual([]);
  });

  test("get_current_issue returns null when no issueId", async () => {
    mockConvex.query.mockReturnValue(null as any);
    const response = await sendJsonRpc(port, "tools/call", {
      name: "get_current_issue",
      arguments: {},
    });
    const result = JSON.parse(response.result.content[0].text);
    expect(result).toBeNull();
  });

  test("get_project_columns calls convex query", async () => {
    mockConvex.query.mockReturnValue([{ name: "To Do" }] as any);
    const response = await sendJsonRpc(port, "tools/call", {
      name: "get_project_columns",
      arguments: {},
    });
    const result = JSON.parse(response.result.content[0].text);
    expect(result).toEqual([{ name: "To Do" }]);
  });

  test("unknown tool returns error in response", async () => {
    const response = await sendJsonRpc(port, "tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    });
    // Unknown tool throws, which gets caught and returned as parse error
    expect(response.error).toBeDefined();
  });
});

describe("McpServer with allowlist", () => {
  let server: McpServer;
  let port: number;
  const mockConvex = {
    query: mock((..._args: any[]) => null),
    mutation: mock((..._args: any[]) => "mockId"),
  };

  beforeAll(async () => {
    server = new McpServer(
      mockConvex as any,
      "projectId" as any,
      "workspaceId2" as any,
      undefined,
      ["create_issue", "get_issue"],
    );
    const result = await server.start();
    port = result.port;
  });

  afterAll(() => {
    server.stop();
  });

  test("tools/list returns only allowed tools", async () => {
    const response = await sendJsonRpc(port, "tools/list", {});
    expect(response.result.tools.length).toBe(2);
    const names = response.result.tools.map((t: any) => t.name);
    expect(names).toContain("create_issue");
    expect(names).toContain("get_issue");
    expect(names).not.toContain("delete_issue");
  });

  test("calling disallowed tool returns error", async () => {
    const response = await sendJsonRpc(port, "tools/call", {
      name: "delete_issue",
      arguments: { issueId: "id" },
    });
    expect(response.error).toBeDefined();
  });
});

describe("McpServer planning tools phase validation", () => {
  let server: McpServer;
  let port: number;
  const mockConvex = {
    query: mock((..._args: any[]) => null),
    mutation: mock((..._args: any[]) => "mockId"),
  };

  beforeAll(async () => {
    server = new McpServer(
      mockConvex as any,
      "projectId" as any,
      "workspaceId3" as any,
      undefined,
      null,
    );
    const result = await server.start();
    port = result.port;
  });

  afterAll(() => {
    server.stop();
  });

  test("submit_plan rejects when not in planning phase", async () => {
    // Mock workspace with coding status
    mockConvex.query.mockReturnValue({ status: "coding", plan: null, planApproved: false } as any);
    const response = await sendJsonRpc(port, "tools/call", {
      name: "submit_plan",
      arguments: { plan: "My plan" },
    });
    // Error is caught and returned as parse error
    expect(response.error).toBeDefined();
  });

  test("ask_question rejects during review phase", async () => {
    mockConvex.query.mockReturnValue({ status: "reviewing" } as any);
    const response = await sendJsonRpc(port, "tools/call", {
      name: "ask_question",
      arguments: { question: "What about X?" },
    });
    expect(response.error).toBeDefined();
  });

  test("get_plan returns plan data", async () => {
    mockConvex.query.mockReturnValue({ plan: "Step 1", planApproved: true } as any);
    const response = await sendJsonRpc(port, "tools/call", {
      name: "get_plan",
      arguments: {},
    });
    const result = JSON.parse(response.result.content[0].text);
    expect(result.plan).toBe("Step 1");
    expect(result.approved).toBe(true);
  });

  test("get_feedback returns and marks messages", async () => {
    mockConvex.query.mockReturnValue([
      { _id: "msg1", body: "Fix the tests", author: "user", createdAt: 1000 },
    ] as any);
    const response = await sendJsonRpc(port, "tools/call", {
      name: "get_feedback",
      arguments: {},
    });
    const result = JSON.parse(response.result.content[0].text);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].body).toBe("Fix the tests");
  });
});
