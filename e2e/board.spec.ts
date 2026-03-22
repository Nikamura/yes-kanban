import { test, expect } from "@playwright/test";
import { ensureBoardWithIssue } from "./helpers";

test.describe("Board", () => {
  test("shows app heading", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText("Yes Kanban");
  });

  test("can create a project and see default columns", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);

    const addBtn = page.locator(".project-sidebar-add");

    if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addBtn.click();
    } else {
      await page.getByRole("button", { name: "Create Project" }).click();
    }

    await expect(page.getByRole("heading", { name: "Create Project" })).toBeVisible({ timeout: 5000 });

    const nameField = page.locator(".dialog input[type='text']").first();
    await nameField.fill(`E2E Project ${Date.now()}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.locator(".column-name").filter({ hasText: "To Do" })).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".column-name").filter({ hasText: "In Progress" })).toBeVisible();
    await expect(page.locator(".column-name").filter({ hasText: "In Review" })).toBeVisible();
    await expect(page.locator(".column-name").filter({ hasText: "Done" })).toBeVisible();
  });

  test("can create an issue in a column", async ({ page }) => {
    await ensureBoardWithIssue(page);

    const addButtons = page.locator(".column-add-btn");
    await addButtons.first().click();

    const uniqueTitle = `E2E issue ${Date.now()}`;
    await page.getByRole("textbox", { name: /needs to be done/i }).fill(uniqueTitle);
    await page.getByRole("textbox", { name: /description/i }).fill("Automated test description");
    await page.locator(".dialog select").selectOption("medium");
    await page.getByRole("textbox", { name: /tag/i }).fill("e2e, test");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText(uniqueTitle)).toBeVisible();
    await expect(page.locator(".issue-tag").filter({ hasText: "e2e" }).first()).toBeVisible();
    await expect(page.locator(".issue-priority").filter({ hasText: /medium/i }).first()).toBeVisible();
  });

  test("can create an issue with file attachment", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.locator(".column-add-btn").first().click();
    await expect(page.getByRole("heading", { name: "Create Issue" })).toBeVisible();

    const uniqueTitle = `Attachment issue ${Date.now()}`;
    await page.getByRole("textbox", { name: /needs to be done/i }).fill(uniqueTitle);
    await page.getByRole("textbox", { name: /description/i }).fill("Issue with attachment");

    // Verify drop zone is visible
    await expect(page.locator(".drop-zone")).toBeVisible();

    // Attach a file via the hidden file input
    const fileInput = page.locator('.dialog input[type="file"]');
    await fileInput.setInputFiles({
      name: "test-file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello from E2E test"),
    });

    // Verify the pending file appears in the list
    await expect(page.locator(".pending-files .attachment-name").filter({ hasText: "test-file.txt" })).toBeVisible();
    await expect(page.locator(".pending-files .attachment-size")).toHaveText("19 B");

    // Can remove a pending file
    await page.locator(".pending-files .btn-danger").click();
    await expect(page.locator(".pending-files")).toBeHidden();

    // Re-attach for creation
    await fileInput.setInputFiles({
      name: "test-file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello from E2E test"),
    });
    await expect(page.locator(".pending-files .attachment-name").filter({ hasText: "test-file.txt" })).toBeVisible();

    await page.getByRole("button", { name: "Create", exact: true }).click();

    // Wait for dialog to close (uses allSettled so closes even if upload fails)
    await expect(page.locator(".dialog-overlay")).toBeHidden({ timeout: 15000 });

    // Verify issue was created
    await expect(page.getByText(uniqueTitle)).toBeVisible();
  });

  test("can open issue detail panel", async ({ page }) => {
    await ensureBoardWithIssue(page);

    const issueCard = page.locator(".issue-card").first();
    await issueCard.click();

    await expect(page.locator(".detail-panel")).toBeVisible();
    await expect(page.locator(".panel-header .issue-id")).toBeVisible();
    await expect(page.locator(".detail-panel").getByText("Recurrence")).not.toBeVisible();
  });

  test("can navigate to settings", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Settings" }).click();

    await expect(page.getByText("Columns")).toBeVisible();
    await expect(page.getByText("Repositories")).toBeVisible();
    await expect(page.getByText("Agent Configurations")).toBeVisible();
    await expect(page.getByText("Recurrence Rules")).not.toBeVisible();
  });

  test("can toggle column visibility in settings", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Columns")).toBeVisible();

    const visibleCheckboxes = page.locator(".toggle-label").filter({ hasText: "Visible" });
    await expect(visibleCheckboxes.first()).toBeVisible();
  });

  test("can add a comment on issue detail", async ({ page }) => {
    await ensureBoardWithIssue(page);

    const issueCard = page.locator(".issue-card").first();
    await issueCard.click();
    await expect(page.locator(".detail-panel")).toBeVisible();

    const uniqueComment = `Comment ${Date.now()}`;
    const commentBox = page.locator(".comment-form textarea");
    await commentBox.fill(uniqueComment);
    await page.locator(".comment-form .btn-primary").click();

    await expect(page.locator(".comment-body").filter({ hasText: uniqueComment })).toBeVisible();
  });

  test("shows dispatch status in settings", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Settings" }).click();

    await expect(page.getByText("Dispatch Status")).toBeVisible();
    await expect(page.getByText("Running")).toBeVisible();
    await expect(page.getByText("Queued")).toBeVisible();
  });

  test("can create and manage prompt templates in settings", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Prompt Templates")).toBeVisible();
    await expect(page.getByText("No custom templates")).toBeVisible();

    // Create a new template
    const section = page.locator(".settings-section").filter({ hasText: "Prompt Templates" });
    await section.getByRole("button", { name: "+ Add" }).click();

    await section.locator("input[placeholder='Template name']").fill("My Workflow");
    const textarea = section.locator("textarea.import-textarea");
    await textarea.fill("Custom instructions for {{issueId}}");
    await section.getByRole("button", { name: "Create" }).click();

    // Verify template appears
    await expect(page.getByText("My Workflow")).toBeVisible();
    await expect(page.locator(".badge").filter({ hasText: "Active" })).toBeVisible();
  });

  test("clicking Yes Kanban title navigates to board", async ({ page }) => {
    await ensureBoardWithIssue(page);

    // Navigate away from board to settings
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Columns")).toBeVisible();

    // Click the Yes Kanban title
    await page.getByRole("heading", { name: "Yes Kanban" }).click();

    // Should be back on board view
    await expect(page.locator(".column-name").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveClass(/active/);
  });

  test("can navigate to dashboard", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Dashboard" }).click();

    await expect(page.locator(".dashboard-wrapper")).toBeVisible();
    await expect(page.getByText("Cumulative Flow")).toBeVisible();
  });

  test("issue detail URL persists across page refresh", async ({ page }) => {
    await ensureBoardWithIssue(page);

    // Open issue detail
    const issueCard = page.locator(".issue-card").first();
    await issueCard.click();
    await expect(page.locator(".detail-panel")).toBeVisible();

    // Get the issue simpleId from the panel header
    const simpleId = await page.locator(".panel-header .issue-id").innerText();

    // Verify URL contains the issue simpleId
    const url = page.url();
    expect(url).toContain(simpleId);

    // Refresh the page
    await page.reload();
    await page.waitForTimeout(1500);

    // Issue detail should still be open after refresh
    await expect(page.locator(".detail-panel")).toBeVisible();
    await expect(page.locator(".panel-header .issue-id")).toHaveText(simpleId);
  });

  test("ESC closes create project dialog", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);

    const addBtn = page.locator(".project-sidebar-add");
    if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addBtn.click();
    } else {
      await page.getByRole("button", { name: "Create Project" }).click();
    }

    await expect(page.locator(".dialog-overlay")).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog-overlay")).toBeHidden({ timeout: 5000 });
  });

  test("ESC closes create issue dialog", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.locator(".column-add-btn").first().click();
    await expect(page.locator(".dialog-overlay")).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog-overlay")).toBeHidden({ timeout: 5000 });
  });

  test("ESC closes issue detail panel", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.locator(".issue-card").first().click();
    await expect(page.locator(".detail-panel")).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(page.locator(".detail-panel")).toBeHidden({ timeout: 5000 });
  });

  test("list view issue detail URL persists across page refresh", async ({ page }) => {
    await ensureBoardWithIssue(page);

    // Switch to list view
    await page.getByRole("button", { name: "List" }).click();
    await expect(page.locator(".list-view")).toBeVisible();

    // Click an issue in the table (desktop) or card (mobile)
    const tableRow = page.locator(".list-table tbody tr").first();
    await tableRow.click();
    await expect(page.locator(".detail-panel")).toBeVisible();

    const simpleId = await page.locator(".panel-header .issue-id").innerText();
    expect(page.url()).toContain(simpleId);

    // Refresh
    await page.reload();
    await page.waitForTimeout(1500);

    // Issue detail should still be open
    await expect(page.locator(".detail-panel")).toBeVisible();
    await expect(page.locator(".panel-header .issue-id")).toHaveText(simpleId);
  });
});
