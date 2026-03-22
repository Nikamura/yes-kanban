import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

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
