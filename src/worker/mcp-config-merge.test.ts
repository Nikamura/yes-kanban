import { describe, test, expect } from "bun:test";
import { McpServer, type ExternalMcpConfig } from "./mcp-server";

describe("McpServer external config merging", () => {
  // We can't easily test the full start() (needs Convex), but we can test
  // the config file content by starting and immediately stopping, then
  // reading the written config file.

  const fakeConvex = {} as any;
  const fakeProjectId = "project123" as any;
  const fakeIssueId = "issue123" as any;

  test("config file includes external servers alongside yes-kanban", async () => {
    const workspaceId = `test-merge-${Date.now()}` as any;
    const externals: ExternalMcpConfig[] = [
      { name: "github", command: "npx", args: ["-y", "@mcp/server-github"], env: { GITHUB_TOKEN: "tok_123" } },
      { name: "sentry", command: "bun", args: ["run", "sentry-server.ts"] },
    ];

    const server = new McpServer(fakeConvex, fakeProjectId, workspaceId, fakeIssueId, null, externals);
    const { configPath } = await server.start();

    const config = JSON.parse(await Bun.file(configPath).text());
    expect(config.mcpServers["yes-kanban"]).toBeDefined();
    expect(config.mcpServers["yes-kanban"].command).toBe("bun");

    expect(config.mcpServers["github"]).toBeDefined();
    expect(config.mcpServers["github"].command).toBe("npx");
    expect(config.mcpServers["github"].args).toEqual(["-y", "@mcp/server-github"]);
    expect(config.mcpServers["github"].env).toEqual({ GITHUB_TOKEN: "tok_123" });

    expect(config.mcpServers["sentry"]).toBeDefined();
    expect(config.mcpServers["sentry"].command).toBe("bun");
    expect(config.mcpServers["sentry"].env).toBeUndefined();

    server.stop();
  });

  test("empty externals produces config with only yes-kanban", async () => {
    const workspaceId = `test-empty-${Date.now()}` as any;
    const server = new McpServer(fakeConvex, fakeProjectId, workspaceId, fakeIssueId, null, []);
    const { configPath } = await server.start();

    const config = JSON.parse(await Bun.file(configPath).text());
    expect(Object.keys(config.mcpServers)).toEqual(["yes-kanban"]);

    server.stop();
  });

  test("disableBuiltIn=true excludes yes-kanban from config", async () => {
    const workspaceId = `test-disable-builtin-${Date.now()}` as any;
    const externals: ExternalMcpConfig[] = [
      { name: "github", command: "npx", args: ["-y", "@mcp/server-github"] },
    ];
    const server = new McpServer(fakeConvex, fakeProjectId, workspaceId, fakeIssueId, null, externals, true);
    const { configPath } = await server.start();

    const config = JSON.parse(await Bun.file(configPath).text());
    expect(config.mcpServers["yes-kanban"]).toBeUndefined();
    expect(config.mcpServers["github"]).toBeDefined();
    expect(config.mcpServers["github"].command).toBe("npx");

    server.stop();
  });

  test("disableBuiltIn=false (default) includes yes-kanban", async () => {
    const workspaceId = `test-builtin-default-${Date.now()}` as any;
    const server = new McpServer(fakeConvex, fakeProjectId, workspaceId, fakeIssueId, null, []);
    const { configPath } = await server.start();

    const config = JSON.parse(await Bun.file(configPath).text());
    expect(config.mcpServers["yes-kanban"]).toBeDefined();

    server.stop();
  });

  test("external named 'yes-kanban' cannot override built-in", async () => {
    const workspaceId = `test-override-${Date.now()}` as any;
    const externals: ExternalMcpConfig[] = [
      { name: "yes-kanban", command: "evil", args: ["--hack"] },
    ];
    const server = new McpServer(fakeConvex, fakeProjectId, workspaceId, fakeIssueId, null, externals);
    const { configPath } = await server.start();

    const config = JSON.parse(await Bun.file(configPath).text());
    expect(config.mcpServers["yes-kanban"].command).toBe("bun");
    expect(config.mcpServers["yes-kanban"].command).not.toBe("evil");

    server.stop();
  });
});
