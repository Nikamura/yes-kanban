import { describe, expect, it } from "bun:test";
import { parseGitHubIssues, mapGitHubStatus } from "./github";
import { parseLinearCsv, mapLinearStatus } from "./linear";
import { parseJiraCsv, mapJiraStatus } from "./jira";
import { parseGenericCsv } from "./csv";
import { exportToJson, exportToCsv } from "../exporters/index";
import type { ImportedIssue } from "./index";

describe("GitHub importer", () => {
  it("parses GitHub issue JSON", () => {
    const ghJson = [
      {
        title: "Fix login bug",
        body: "Users cannot log in with SSO",
        state: "OPEN",
        labels: [{ name: "bug" }, { name: "auth" }],
        number: 42,
      },
      {
        title: "Add dark mode",
        body: "Support dark theme",
        state: "CLOSED",
        labels: [],
        number: 99,
      },
    ];

    const issues = parseGitHubIssues(ghJson);
    expect(issues).toHaveLength(2);

    expect(issues[0]!.title).toBe("Fix login bug");
    expect(issues[0]!.description).toBe("Users cannot log in with SSO");
    expect(issues[0]!.status).toBe("To Do");
    expect(issues[0]!.tags).toEqual(["bug", "auth"]);
    expect(issues[0]!.externalId).toBe("github-42");

    expect(issues[1]!.title).toBe("Add dark mode");
    expect(issues[1]!.status).toBe("Done");
    expect(issues[1]!.tags).toEqual([]);
    expect(issues[1]!.externalId).toBe("github-99");
  });

  it("maps GitHub states to kanban columns", () => {
    expect(mapGitHubStatus("OPEN")).toBe("To Do");
    expect(mapGitHubStatus("CLOSED")).toBe("Done");
    expect(mapGitHubStatus("unknown")).toBe("To Do");
  });

  it("handles missing body gracefully", () => {
    const ghJson = [
      { title: "No body issue", body: null, state: "OPEN", labels: [], number: 1 },
    ];
    const issues = parseGitHubIssues(ghJson);
    expect(issues[0]!.description).toBe("");
  });
});

describe("Linear importer", () => {
  it("parses Linear CSV export", () => {
    const csv = `Title,Description,Status,Priority,Labels,Identifier
Fix crash on startup,App crashes when opening,In Progress,Urgent,"bug,critical",LIN-123
Add search feature,Full text search,Backlog,Medium,feature,LIN-456`;

    const issues = parseLinearCsv(csv);
    expect(issues).toHaveLength(2);

    expect(issues[0]!.title).toBe("Fix crash on startup");
    expect(issues[0]!.description).toBe("App crashes when opening");
    expect(issues[0]!.status).toBe("In Progress");
    expect(issues[0]!.priority).toBe("Urgent");
    expect(issues[0]!.tags).toEqual(["bug", "critical"]);
    expect(issues[0]!.externalId).toBe("linear-LIN-123");

    expect(issues[1]!.title).toBe("Add search feature");
    expect(issues[1]!.status).toBe("To Do");
    expect(issues[1]!.priority).toBe("Medium");
    expect(issues[1]!.tags).toEqual(["feature"]);
  });

  it("maps Linear states to kanban columns", () => {
    expect(mapLinearStatus("Backlog")).toBe("To Do");
    expect(mapLinearStatus("Todo")).toBe("To Do");
    expect(mapLinearStatus("In Progress")).toBe("In Progress");
    expect(mapLinearStatus("In Review")).toBe("In Progress");
    expect(mapLinearStatus("Done")).toBe("Done");
    expect(mapLinearStatus("Cancelled")).toBe("Done");
    expect(mapLinearStatus("Triage")).toBe("To Do");
  });

  it("handles empty CSV", () => {
    const csv = `Title,Description,Status,Priority,Labels,Identifier`;
    const issues = parseLinearCsv(csv);
    expect(issues).toHaveLength(0);
  });
});

describe("Jira importer", () => {
  it("parses Jira CSV export", () => {
    const csv = `Summary,Description,Status,Priority,Labels,Issue key
Fix API timeout,API calls timing out after 30s,In Progress,High,"backend,api",PROJ-101
Update docs,Update README with new API endpoints,To Do,Low,docs,PROJ-102`;

    const issues = parseJiraCsv(csv);
    expect(issues).toHaveLength(2);

    expect(issues[0]!.title).toBe("Fix API timeout");
    expect(issues[0]!.description).toBe("API calls timing out after 30s");
    expect(issues[0]!.status).toBe("In Progress");
    expect(issues[0]!.priority).toBe("High");
    expect(issues[0]!.tags).toEqual(["backend", "api"]);
    expect(issues[0]!.externalId).toBe("jira-PROJ-101");

    expect(issues[1]!.status).toBe("To Do");
    expect(issues[1]!.tags).toEqual(["docs"]);
  });

  it("maps Jira statuses to kanban columns", () => {
    expect(mapJiraStatus("To Do")).toBe("To Do");
    expect(mapJiraStatus("Open")).toBe("To Do");
    expect(mapJiraStatus("Backlog")).toBe("To Do");
    expect(mapJiraStatus("In Progress")).toBe("In Progress");
    expect(mapJiraStatus("In Review")).toBe("In Progress");
    expect(mapJiraStatus("Done")).toBe("Done");
    expect(mapJiraStatus("Closed")).toBe("Done");
    expect(mapJiraStatus("Resolved")).toBe("Done");
  });

  it("handles empty CSV", () => {
    const csv = `Summary,Description,Status,Priority,Labels,Issue key`;
    const issues = parseJiraCsv(csv);
    expect(issues).toHaveLength(0);
  });
});

describe("Generic CSV importer", () => {
  it("parses CSV in the standard export format", () => {
    const csv = `Title,Description,Status,Priority,Tags,External ID
Fix bug,A critical bug,In Progress,High,"bug,urgent",EXT-1
Add feature,New feature request,To Do,Medium,feature,EXT-2`;

    const issues = parseGenericCsv(csv);
    expect(issues).toHaveLength(2);

    expect(issues[0]!.title).toBe("Fix bug");
    expect(issues[0]!.description).toBe("A critical bug");
    expect(issues[0]!.status).toBe("In Progress");
    expect(issues[0]!.priority).toBe("High");
    expect(issues[0]!.tags).toEqual(["bug", "urgent"]);
    expect(issues[0]!.externalId).toBe("EXT-1");

    expect(issues[1]!.title).toBe("Add feature");
    expect(issues[1]!.status).toBe("To Do");
    expect(issues[1]!.priority).toBe("Medium");
    expect(issues[1]!.tags).toEqual(["feature"]);
  });

  it("handles empty CSV", () => {
    const csv = `Title,Description,Status,Priority,Tags,External ID`;
    const issues = parseGenericCsv(csv);
    expect(issues).toHaveLength(0);
  });

  it("handles missing optional fields", () => {
    const csv = `Title,Description,Status,Priority,Tags,External ID
Just a title,Some desc,To Do,,,`;

    const issues = parseGenericCsv(csv);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.title).toBe("Just a title");
    expect(issues[0]!.priority).toBeUndefined();
    expect(issues[0]!.tags).toEqual([]);
    expect(issues[0]!.externalId).toBe("csv-0");
  });

  it("roundtrips with exporter", () => {
    const original: ImportedIssue[] = [
      {
        title: "Test issue",
        description: "Test description",
        status: "To Do",
        priority: "High",
        tags: ["test"],
        externalId: "EXT-99",
      },
    ];
    const csv = exportToCsv(original);
    const reimported = parseGenericCsv(csv);
    expect(reimported[0]!.title).toBe("Test issue");
    expect(reimported[0]!.description).toBe("Test description");
    expect(reimported[0]!.status).toBe("To Do");
    expect(reimported[0]!.priority).toBe("High");
    expect(reimported[0]!.tags).toEqual(["test"]);
    expect(reimported[0]!.externalId).toBe("EXT-99");
  });
});

describe("Exporters", () => {
  const sampleIssues: ImportedIssue[] = [
    {
      title: "Fix bug",
      description: "A critical bug",
      status: "In Progress",
      priority: "High",
      tags: ["bug", "urgent"],
      externalId: "EXT-1",
    },
    {
      title: "Add feature",
      description: "New feature request",
      status: "To Do",
      priority: "Medium",
      tags: ["feature"],
      externalId: "EXT-2",
    },
  ];

  it("exports issues to JSON", () => {
    const json = exportToJson(sampleIssues);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.title).toBe("Fix bug");
    expect(parsed[1]!.tags).toEqual(["feature"]);
  });

  it("exports issues to CSV", () => {
    const csv = exportToCsv(sampleIssues);
    const lines = csv.split("\n");
    expect(lines[0]!).toBe("Title,Description,Status,Priority,Tags,External ID");
    expect(lines).toHaveLength(3);
    expect(lines[1]!).toContain("Fix bug");
    expect(lines[1]!).toContain("A critical bug");
    expect(lines[2]!).toContain("Add feature");
  });

  it("handles empty array", () => {
    const json = exportToJson([]);
    expect(JSON.parse(json)).toEqual([]);

    const csv = exportToCsv([]);
    expect(csv).toBe("Title,Description,Status,Priority,Tags,External ID");
  });

  it("escapes commas in CSV fields", () => {
    const issues: ImportedIssue[] = [
      {
        title: "Fix, this bug",
        description: 'He said "hello"',
        status: "To Do",
        priority: "High",
        tags: ["a", "b"],
        externalId: "EXT-1",
      },
    ];
    const csv = exportToCsv(issues);
    const lines = csv.split("\n");
    // Fields with commas or quotes should be properly escaped
    expect(lines[1]!).toContain('"Fix, this bug"');
  });
});
