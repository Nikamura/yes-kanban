import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

/**
 * Convex HTTP URL for E2E seeding (must match the UI’s `VITE_CONVEX_URL`).
 * `scripts/test-e2e.sh` sets this to the isolated backend port.
 */
export function getE2eConvexUrl(): string {
  return process.env["E2E_CONVEX_URL"] ?? "http://127.0.0.1:3210";
}

/**
 * Create a project, issue, workspace in `awaiting_feedback`, and one pending
 * agent question with exactly three suggested answers (Convex validation).
 */
export async function seedWorkspaceWithPendingQuestion(): Promise<{
  slug: string;
  issueSimpleId: string;
  workspaceId: string;
  suggestions: [string, string, string];
}> {
  const client = new ConvexHttpClient(getE2eConvexUrl(), {
    skipConvexDeploymentUrlCheck: true,
  });
  const suffix = Date.now();
  const slug = `e2e-wq-${suffix}`;

  const projectId = await client.mutation(api.projects.create, {
    name: `E2E Workspace Questions ${suffix}`,
    slug,
    simpleIdPrefix: "E2E",
  });

  const agentConfigId = await client.mutation(api.agentConfigs.create, {
    projectId,
    name: "E2E Agent",
    agentType: "claude-code",
    command: "echo",
  });

  const issueId = await client.mutation(api.issues.create, {
    projectId,
    title: "E2E workspace question flow",
    description: "Seeded for workspace question UI test",
    status: "To Do",
  });

  const workspaceId = await client.mutation(api.workspaces.create, {
    issueId,
    projectId,
    agentConfigId,
  });

  await client.mutation(api.workspaces.updateStatus, {
    id: workspaceId,
    status: "awaiting_feedback",
  });

  const suggestions: [string, string, string] = [
    "First suggested answer",
    "Second suggested answer",
    "Third suggested answer",
  ];

  await client.mutation(api.agentQuestions.create, {
    workspaceId,
    question: "Which approach should we take?",
    suggestedAnswers: suggestions,
  });

  const issue = await client.query(api.issues.get, { id: issueId });
  if (!issue) {
    throw new Error("Expected issue after seeding");
  }

  return { slug, issueSimpleId: issue.simpleId, workspaceId, suggestions };
}

/**
 * Seed a project with a known issue via the Convex API.
 * Returns the slug so tests can navigate directly to the correct project.
 */
export async function seedProjectWithIssue(): Promise<{ slug: string }> {
  const client = new ConvexHttpClient(getE2eConvexUrl(), {
    skipConvexDeploymentUrlCheck: true,
  });
  const suffix = Date.now();
  const slug = `e2e-list-${suffix}`;

  const projectId = await client.mutation(api.projects.create, {
    name: `E2E List ${suffix}`,
    slug,
    simpleIdPrefix: "LST",
  });

  await client.mutation(api.issues.create, {
    projectId,
    title: "Implement user authentication",
    description: "Add login/logout flow",
    status: "To Do",
    tags: ["backend", "auth"],
  });

  return { slug };
}

/**
 * Ensure a project exists on the board with at least one issue.
 * Creates them if the DB is fresh (isolated test instance).
 */
export async function ensureBoardWithIssue(page: Page) {
  await page.goto("/");

  // Wait for app to load
  await page.waitForTimeout(1500);

  const hasBoard = await page.locator(".column-name").first().isVisible({ timeout: 2000 }).catch(() => false);

  if (!hasBoard) {
    // Fresh DB — create a project first
    const createBtn = page.getByRole("button", { name: "Create Project" });
    if (await createBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createBtn.click();
    } else {
      await page.locator(".project-sidebar-add").click();
    }

    await expect(page.getByRole("heading", { name: "Create Project" })).toBeVisible({ timeout: 5000 });
    await page.locator(".dialog input[type='text']").first().fill("Test Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".column-name").first()).toBeVisible({ timeout: 5000 });
  }

  // Check if any issues exist
  const issueCards = page.locator(".issue-card");
  const count = await issueCards.count();

  if (count === 0) {
    // Create a seed issue
    await page.locator(".column-add-btn").first().click();
    await page.getByRole("textbox", { name: /needs to be done/i }).fill("Implement user authentication");
    await page.getByRole("textbox", { name: /description/i }).fill("Add login/logout flow");
    await page.locator(".dialog select").selectOption("high");
    await page.getByRole("textbox", { name: /tag/i }).fill("backend, auth");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Implement user authentication")).toBeVisible();
  }
}
