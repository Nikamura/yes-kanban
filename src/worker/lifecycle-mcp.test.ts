import { describe, test, expect } from "bun:test";
import { McpServer } from "./mcp-server";

describe("Lifecycle MCP integration", () => {
  test("McpServer can be instantiated with required parameters", () => {
    // Verify the McpServer constructor accepts all required params
    const server = new McpServer(
      {} as any, // convex client
      "projectId" as any,
      "workspaceId" as any,
      "issueId" as any,
      null, // allowedTools
    );
    expect(server).toBeDefined();
    expect(server).toBeInstanceOf(McpServer);
  });

  test("McpServer start returns port and configPath", async () => {
    const server = new McpServer(
      {} as any,
      "projectId" as any,
      "workspaceId" as any,
      undefined,
      null,
    );

    const result = await server.start();
    expect(result.port).toBeGreaterThan(0);
    expect(result.configPath).toContain("yes-kanban-mcp");

    server.stop();
  });

  test("McpServer stop cleans up resources", async () => {
    const server = new McpServer(
      {} as any,
      "projectId" as any,
      "workspaceId" as any,
      undefined,
      null,
    );

    await server.start();
    // Should not throw
    server.stop();
  });
});
