import { describe, test, expect } from "bun:test";
import { buildPrompt, buildReviewPrompt, buildPlanReviewPrompt, buildRebaseConflictPrompt, buildPlanningPrompt, buildFixPrompt } from "./prompt-builder";

describe("buildPrompt", () => {
  test("includes issue title and description", () => {
    const prompt = buildPrompt(
      { title: "Fix login bug", simpleId: "TASK-1", description: "Users can't log in", priority: undefined, tags: [] } as any,
      undefined,
      [],
    );
    expect(prompt).toContain("Fix login bug");
    expect(prompt).toContain("TASK-1");
    expect(prompt).toContain("Users can't log in");
  });

  test("includes priority and tags when present", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: "high", tags: ["frontend", "auth"] } as any,
      undefined,
      [],
    );
    expect(prompt).toContain("high");
    expect(prompt).toContain("frontend");
    expect(prompt).toContain("auth");
  });

  test("includes worktree info", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [{ repoPath: "/home/user/repo", branchName: "yes-kanban/proj/T-1", baseBranch: "main", worktreePath: "/tmp/wt" } as any],
    );
    expect(prompt).toContain("/home/user/repo");
    expect(prompt).toContain("yes-kanban/proj/T-1");
    expect(prompt).toContain("main");
  });

  test("includes additional prompt", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      "Also update the README",
      [],
    );
    expect(prompt).toContain("Also update the README");
  });

  test("includes attachments when provided", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      undefined,
      undefined,
      [
        { filename: "screenshot.png", mimeType: "image/png", size: 102400, url: "https://example.com/screenshot.png" },
        { filename: "spec.pdf", mimeType: "application/pdf", size: 2048576, url: "https://example.com/spec.pdf" },
      ],
    );
    expect(prompt).toContain("## Attachments");
    expect(prompt).toContain("[screenshot.png](https://example.com/screenshot.png)");
    expect(prompt).toContain("image/png");
    expect(prompt).toContain("100.0 KB");
    expect(prompt).toContain("[spec.pdf](https://example.com/spec.pdf)");
  });

  test("omits attachments section when empty", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      undefined,
      undefined,
      [],
    );
    expect(prompt).not.toContain("## Attachments");
  });

  test("works without issue (standalone workspace)", () => {
    const prompt = buildPrompt(undefined, "Do something", []);
    expect(prompt).toContain("Do something");
    expect(prompt).toContain("Instructions");
  });

  test("includes standard instructions", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
    );
    expect(prompt).toContain("Self-review");
    expect(prompt).toContain("Commit your changes");
    expect(prompt).toContain("T-1");
  });
});

describe("buildPrompt resumed with lastError", () => {
  test("includes error details when resumed with lastError", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      true,
      "Agent exited with code 1: Error: test failed",
    );
    expect(prompt).toContain("RESUMED");
    expect(prompt).toContain("Previous Failure");
    expect(prompt).toContain("Agent exited with code 1: Error: test failed");
    expect(prompt).toContain("take a different approach");
  });

  test("resumed without lastError shows generic message", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      true,
    );
    expect(prompt).toContain("RESUMED");
    expect(prompt).not.toContain("Previous Failure");
    expect(prompt).not.toContain("take a different approach");
  });

  test("not resumed does not show error section", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      "Agent timed out",
    );
    expect(prompt).not.toContain("RESUMED");
    expect(prompt).not.toContain("Previous Failure");
  });
});

describe("buildReviewPrompt", () => {
  test("includes issue context and diff", () => {
    const prompt = buildReviewPrompt(
      { title: "Add feature", simpleId: "TASK-5", description: "Add a new button" } as any,
      "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+const x = 1;",
    );
    expect(prompt).toContain("Add feature");
    expect(prompt).toContain("TASK-5");
    expect(prompt).toContain("Add a new button");
    expect(prompt).toContain("const x = 1");
  });

  test("includes review criteria", () => {
    const prompt = buildReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "" } as any,
      "diff",
    );
    expect(prompt).toContain("Bugs");
    expect(prompt).toContain("Security");
    expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("REQUEST_CHANGES");
  });
});

describe("buildPrompt with template override", () => {
  test("uses custom template instead of hardcoded instructions", () => {
    const template = "Follow the project coding standards.\nWrite unit tests first.";
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "Do stuff", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      undefined,
      template,
    );
    expect(prompt).toContain("Follow the project coding standards");
    expect(prompt).toContain("Write unit tests first");
    // Should NOT contain the default hardcoded instructions
    expect(prompt).not.toContain("Self-review your changes before finishing");
  });

  test("still includes issue context with custom template", () => {
    const template = "Custom instructions here.";
    const prompt = buildPrompt(
      { title: "My Task", simpleId: "T-99", description: "Fix the thing", priority: "high", tags: ["bug"] } as any,
      undefined,
      [],
      false,
      undefined,
      template,
    );
    expect(prompt).toContain("My Task");
    expect(prompt).toContain("T-99");
    expect(prompt).toContain("Fix the thing");
    expect(prompt).toContain("high");
    expect(prompt).toContain("bug");
  });

  test("template supports {{issueId}} and {{title}} placeholders", () => {
    const template = "Work on {{issueId}}: {{title}}.\nDo your best.";
    const prompt = buildPrompt(
      { title: "Login Bug", simpleId: "BUG-42", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      undefined,
      template,
    );
    expect(prompt).toContain("Work on BUG-42: Login Bug.");
  });

  test("additional prompt still appended with custom template", () => {
    const template = "Custom workflow.";
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      "Also check for regressions",
      [],
      false,
      undefined,
      template,
    );
    expect(prompt).toContain("Custom workflow");
    expect(prompt).toContain("Also check for regressions");
  });
});

describe("buildReviewPrompt with attachments", () => {
  test("includes attachments when provided", () => {
    const prompt = buildReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "Fix bug" } as any,
      "diff content",
      undefined,
      [
        { filename: "screenshot.png", mimeType: "image/png", size: 102400, url: "https://example.com/screenshot.png" },
      ],
    );
    expect(prompt).toContain("## Attachments");
    expect(prompt).toContain("[screenshot.png](https://example.com/screenshot.png)");
    expect(prompt).toContain("image/png");
    expect(prompt).toContain("100.0 KB");
  });

  test("omits attachments section when empty", () => {
    const prompt = buildReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "" } as any,
      "diff",
      undefined,
      [],
    );
    expect(prompt).not.toContain("## Attachments");
  });

  test("omits attachments section when undefined", () => {
    const prompt = buildReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "" } as any,
      "diff",
    );
    expect(prompt).not.toContain("## Attachments");
  });
});

describe("buildReviewPrompt with template override", () => {
  test("uses custom review template", () => {
    const template = "Focus on performance and memory leaks.\nOutput: LGTM or NEEDS_WORK";
    const prompt = buildReviewPrompt(
      { title: "Perf fix", simpleId: "T-1", description: "" } as any,
      "diff content",
      template,
    );
    expect(prompt).toContain("Focus on performance and memory leaks");
    expect(prompt).toContain("LGTM or NEEDS_WORK");
    // Should NOT contain default review criteria
    expect(prompt).not.toContain("Missing edge cases");
  });

  test("still includes diff with custom template", () => {
    const template = "Review carefully.";
    const prompt = buildReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "" } as any,
      "--- a/file.ts\n+++ b/file.ts",
      template,
    );
    expect(prompt).toContain("--- a/file.ts");
  });
});

describe("buildRebaseConflictPrompt with template override", () => {
  test("uses custom rebase template", () => {
    const template = "Resolve conflicts for branch rebased onto {{baseBranch}}.\nDo not abort.";
    const prompt = buildRebaseConflictPrompt("main", ["src/index.ts"], template);
    expect(prompt).toContain("Resolve conflicts for branch rebased onto main");
    expect(prompt).toContain("src/index.ts");
  });
});

describe("buildRebaseConflictPrompt", () => {
  test("includes base branch name", () => {
    const prompt = buildRebaseConflictPrompt("main", ["src/index.ts"]);
    expect(prompt).toContain("main");
  });

  test("includes conflicted file names", () => {
    const prompt = buildRebaseConflictPrompt("main", ["src/index.ts", "src/utils.ts"]);
    expect(prompt).toContain("src/index.ts");
    expect(prompt).toContain("src/utils.ts");
  });

  test("instructs not to abort rebase", () => {
    const prompt = buildRebaseConflictPrompt("main", ["file.ts"]);
    expect(prompt.toLowerCase()).toContain("do not");
    expect(prompt.toLowerCase()).toContain("abort");
  });

  test("instructs to git add and rebase --continue", () => {
    const prompt = buildRebaseConflictPrompt("main", ["file.ts"]);
    expect(prompt).toContain("git add");
    expect(prompt).toContain("rebase --continue");
  });
});

describe("buildPlanningPrompt", () => {
  test("includes issue context", () => {
    const prompt = buildPlanningPrompt(
      { title: "Add auth", simpleId: "TASK-1", description: "Implement OAuth", priority: "high", tags: ["auth"] } as any,
      [],
    );
    expect(prompt).toContain("Planning Phase");
    expect(prompt).toContain("Add auth");
    expect(prompt).toContain("TASK-1");
    expect(prompt).toContain("Implement OAuth");
    expect(prompt).toContain("high");
    expect(prompt).toContain("auth");
  });

  test("includes workspace info", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [{ repoPath: "/repo", branchName: "feat/T-1", baseBranch: "main", worktreePath: "/tmp/wt" } as any],
    );
    expect(prompt).toContain("/repo");
    expect(prompt).toContain("feat/T-1");
  });

  test("includes existing plan for revision", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      "## Old Plan\n1. Do stuff",
    );
    expect(prompt).toContain("Previous Plan (needs revision)");
    expect(prompt).toContain("Old Plan");
  });

  test("includes answered questions", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      undefined,
      [{ question: "What auth provider?", answer: "Auth0" }],
    );
    expect(prompt).toContain("What auth provider?");
    expect(prompt).toContain("Auth0");
  });

  test("instructs not to write code", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
    );
    expect(prompt).toContain("Do NOT write any code");
    expect(prompt).toContain("mcp__yes-kanban__submit_plan");
    expect(prompt).toContain("mcp__yes-kanban__ask_question");
  });

  test("includes expanded exploration guidance", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
    );
    expect(prompt).toContain("Trace code paths related to the task");
    expect(prompt).toContain("Identify existing patterns, utilities, and abstractions");
    expect(prompt).toContain("Note tests that cover the affected areas");
  });

  test("includes expanded exploration guidance with deep research", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      true, // deepResearch
    );
    expect(prompt).toContain("Trace code paths related to the task");
    expect(prompt).toContain("Identify existing patterns, utilities, and abstractions");
    // deep research specific content still present
    expect(prompt).toContain("Research online");
    expect(prompt).toContain("WebSearch");
    expect(prompt).toContain("WebFetch");
  });

  test("omits online research tools when deepResearch is false", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
    );
    expect(prompt).not.toContain("Research online");
    expect(prompt).not.toContain("WebSearch");
    expect(prompt).not.toContain("WebFetch");
  });

  test("uses 3-step numbering without deep research", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
    );
    expect(prompt).toContain("2. **Ask clarifying questions**");
    expect(prompt).toContain("3. **Create a plan**");
    expect(prompt).not.toContain("4. **Create a plan**");
  });

  test("uses 4-step numbering with deep research", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(prompt).toContain("2. **Research online**");
    expect(prompt).toContain("3. **Ask clarifying questions**");
    expect(prompt).toContain("4. **Create a plan**");
  });

  test("includes expanded plan structure guidance", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
    );
    expect(prompt).toContain("list every file to be modified or created");
    expect(prompt).toContain("step-by-step implementation order");
    expect(prompt).toContain("backwards compatibility concerns");
    expect(prompt).toContain("types of tests needed");
  });

  test("includes quality bar guidance", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
    );
    expect(prompt).toContain("junior engineer could implement the task from the plan alone");
    expect(prompt).toContain("concrete file paths, function names, and code references");
  });

  test("includes user feedback on previous plan", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      "## Old Plan\n1. Do stuff",
      undefined,
      ["Please also handle error cases", "Consider using the existing auth middleware"],
    );
    expect(prompt).toContain("User Feedback on Previous Plan");
    expect(prompt).toContain("Please also handle error cases");
    expect(prompt).toContain("Consider using the existing auth middleware");
    expect(prompt).toContain("MUST address this feedback");
  });

  test("omits feedback section when no feedback", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      "## Old Plan\n1. Do stuff",
      undefined,
      [],
    );
    expect(prompt).not.toContain("User Feedback");
  });

  test("omits feedback section when no existing plan", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      undefined,
      undefined,
      ["Some feedback"],
    );
    expect(prompt).not.toContain("User Feedback");
  });
});

describe("buildPrompt with plan", () => {
  test("includes approved plan", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      undefined,
      undefined,
      [],
      "## Plan\n1. Step one\n2. Step two",
    );
    expect(prompt).toContain("Approved Implementation Plan");
    expect(prompt).toContain("Step one");
  });

  test("includes experiment number for re-experiments", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      undefined,
      undefined,
      [],
      "Plan content",
      3,
    );
    expect(prompt).toContain("Experiment #3");
    expect(prompt).toContain("start fresh");
  });

  test("does not show experiment note for first experiment", () => {
    const prompt = buildPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      undefined,
      [],
      false,
      undefined,
      undefined,
      [],
      "Plan content",
      1,
    );
    expect(prompt).not.toContain("Experiment #");
  });
});

describe("buildPlanReviewPrompt", () => {
  test("includes issue context and plan", () => {
    const prompt = buildPlanReviewPrompt(
      { title: "Add auth", simpleId: "TASK-5", description: "Implement OAuth" } as any,
      "## Plan\n1. Add middleware\n2. Add tests",
    );
    expect(prompt).toContain("Plan Review");
    expect(prompt).toContain("Add auth");
    expect(prompt).toContain("TASK-5");
    expect(prompt).toContain("Implement OAuth");
    expect(prompt).toContain("Add middleware");
  });

  test("includes review criteria and verdict options", () => {
    const prompt = buildPlanReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "" } as any,
      "Some plan",
    );
    expect(prompt).toContain("Completeness");
    expect(prompt).toContain("Feasibility");
    expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("REQUEST_CHANGES");
    expect(prompt).toContain("RESTART");
  });

  test("uses custom template when provided", () => {
    const template = "Check plan for {{issueId}}.\nOutput: GO or NO_GO";
    const prompt = buildPlanReviewPrompt(
      { title: "Task", simpleId: "T-42", description: "" } as any,
      "Plan content",
      template,
    );
    expect(prompt).toContain("Check plan for T-42");
    expect(prompt).toContain("GO or NO_GO");
    expect(prompt).not.toContain("Completeness");
  });

  test("handles missing issue gracefully", () => {
    const prompt = buildPlanReviewPrompt(undefined, "Some plan");
    expect(prompt).toContain("Unknown");
    expect(prompt).toContain("N/A");
    expect(prompt).toContain("Some plan");
  });

  test("includes attachments when provided", () => {
    const prompt = buildPlanReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "Do stuff" } as any,
      "Plan content",
      undefined,
      [
        { filename: "spec.pdf", mimeType: "application/pdf", size: 2048576, url: "https://example.com/spec.pdf" },
      ],
    );
    expect(prompt).toContain("## Attachments");
    expect(prompt).toContain("[spec.pdf](https://example.com/spec.pdf)");
    expect(prompt).toContain("application/pdf");
  });

  test("omits attachments section when empty", () => {
    const prompt = buildPlanReviewPrompt(
      { title: "Task", simpleId: "T-1", description: "" } as any,
      "Plan",
      undefined,
      [],
    );
    expect(prompt).not.toContain("## Attachments");
  });
});

describe("buildPlanningPrompt with attachments", () => {
  test("includes attachments when provided", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [
        { filename: "design.png", mimeType: "image/png", size: 51200, url: "https://example.com/design.png" },
        { filename: "notes.txt", mimeType: "text/plain", size: 1024, url: "https://example.com/notes.txt" },
      ],
    );
    expect(prompt).toContain("## Attachments");
    expect(prompt).toContain("[design.png](https://example.com/design.png)");
    expect(prompt).toContain("image/png");
    expect(prompt).toContain("50.0 KB");
    expect(prompt).toContain("[notes.txt](https://example.com/notes.txt)");
    expect(prompt).toContain("text/plain");
    expect(prompt).toContain("1.0 KB");
  });

  test("omits attachments section when empty", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    );
    expect(prompt).not.toContain("## Attachments");
  });

  test("omits attachments section when undefined", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
    );
    expect(prompt).not.toContain("## Attachments");
  });
});

describe("buildPlanningPrompt with reviewer feedback", () => {
  test("includes AI reviewer feedback when present", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      "## Old Plan\n1. Do stuff",
      undefined,
      undefined,
      "The plan is missing error handling and testing strategy.",
    );
    expect(prompt).toContain("AI Reviewer Feedback on Previous Plan");
    expect(prompt).toContain("missing error handling");
    expect(prompt).toContain("MUST address this feedback");
  });

  test("omits reviewer feedback when no existing plan", () => {
    const prompt = buildPlanningPrompt(
      { title: "Task", simpleId: "T-1", description: "", priority: undefined, tags: [] } as any,
      [],
      undefined,
      undefined,
      undefined,
      "Some feedback",
    );
    expect(prompt).not.toContain("AI Reviewer Feedback");
  });
});

describe("buildFixPrompt", () => {
  test("includes user instructions in the prompt", () => {
    const prompt = buildFixPrompt("Please add error handling to the login form");
    expect(prompt).toContain("Please add error handling to the login form");
  });

  test("includes 'Changes requested' header", () => {
    const prompt = buildFixPrompt("Fix the button color");
    expect(prompt).toContain("Changes requested:");
  });

  test("includes instruction to address issues", () => {
    const prompt = buildFixPrompt("Update the API endpoint");
    expect(prompt).toContain("Please address these issues");
  });
});
