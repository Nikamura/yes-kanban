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

    const addBtn = page.getByTestId("project-sidebar-add");

    if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addBtn.click();
    } else {
      await page.getByRole("button", { name: "Create Project" }).click();
    }

    await expect(page.getByRole("heading", { name: "Create Project" })).toBeVisible({ timeout: 5000 });

    await page.getByLabel("Name").fill(`E2E Project ${Date.now()}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByTestId("column-name").filter({ hasText: "Backlog" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("column-name").filter({ hasText: "To Do" })).toBeVisible();
    await expect(page.getByTestId("column-name").filter({ hasText: "In Progress" })).toBeVisible();
    await expect(page.getByTestId("column-name").filter({ hasText: "Done" })).toBeVisible();
  });

  test("can create an issue in a column", async ({ page }) => {
    await ensureBoardWithIssue(page);

    const addButtons = page.getByTestId("column-add-btn");
    await addButtons.first().click();

    const uniqueTitle = `E2E issue ${Date.now()}`;
    await page.getByRole("textbox", { name: "Title" }).fill(uniqueTitle);
    await page.getByRole("textbox", { name: /description/i }).fill("Automated test description");
    await page.getByRole("textbox", { name: /tag/i }).fill("e2e, test");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText(uniqueTitle)).toBeVisible();
    await expect(page.getByTestId("issue-tag").filter({ hasText: "e2e" }).first()).toBeVisible();
  });

  test("can create an issue with file attachment", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByTestId("column-add-btn").first().click();
    await expect(page.getByRole("heading", { name: "Create Issue" })).toBeVisible();

    const uniqueTitle = `Attachment issue ${Date.now()}`;
    await page.getByRole("textbox", { name: "Title" }).fill(uniqueTitle);
    await page.getByRole("textbox", { name: /description/i }).fill("Issue with attachment");

    await expect(page.getByTestId("create-issue-drop-zone")).toBeVisible();

    const fileInput = page.getByTestId("create-issue-file-input");
    await fileInput.setInputFiles({
      name: "test-file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello from E2E test"),
    });

    await expect(page.getByTestId("pending-attachment-name").filter({ hasText: "test-file.txt" })).toBeVisible();
    await expect(page.getByTestId("pending-attachment-size")).toHaveText("19 B");

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("pending-files")).toBeHidden();

    await fileInput.setInputFiles({
      name: "test-file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello from E2E test"),
    });
    await expect(page.getByTestId("pending-attachment-name").filter({ hasText: "test-file.txt" })).toBeVisible();

    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.locator('[data-slot="dialog-overlay"]')).toBeHidden({
      timeout: 15000,
    });

    await expect(page.getByText(uniqueTitle)).toBeVisible();
  });

  test("can open issue detail panel", async ({ page }) => {
    await ensureBoardWithIssue(page);

    const issueCard = page.getByTestId("issue-card").first();
    await issueCard.click();

    await expect(page.getByTestId("issue-detail-panel")).toBeVisible();
    await expect(page.getByTestId("issue-detail-simple-id")).toBeVisible();
    await expect(page.getByTestId("issue-detail-panel").getByText("Recurrence")).not.toBeVisible();
  });

  test("can navigate to settings", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Settings" }).click();

    await expect(page.getByText("Workflow")).toBeVisible();
    await expect(page.getByText("Repositories")).toBeVisible();
    await expect(page.getByText("Agent Configurations")).toBeVisible();
    await expect(page.getByText("Recurrence Rules")).not.toBeVisible();
  });

  test("can add a comment on issue detail", async ({ page }) => {
    await ensureBoardWithIssue(page);

    const issueCard = page.getByTestId("issue-card").first();
    await issueCard.click();
    await expect(page.getByTestId("issue-detail-panel")).toBeVisible();

    const uniqueComment = `Comment ${Date.now()}`;
    const commentBox = page.getByTestId("comment-form").locator("textarea");
    await commentBox.fill(uniqueComment);
    await page.getByTestId("comment-form").getByRole("button", { name: "Comment" }).click();

    await expect(page.getByTestId("issue-detail-panel").getByText(uniqueComment)).toBeVisible();
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
    await expect(page.getByText(/No custom templates/)).toBeVisible({
      timeout: 10_000,
    });

    const section = page.getByTestId("prompt-templates-section");
    await section.getByRole("button", { name: "+ Add" }).click();

    await section.locator("input[placeholder='Template name']").fill("My Workflow");
    const textarea = section.locator("textarea").first();
    await textarea.fill("Custom instructions for {{issueId}}");
    await section.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("My Workflow")).toBeVisible();
    await expect(section.getByText("Active", { exact: true })).toBeVisible();
  });

  test("clicking Yes Kanban title navigates to board", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Workflow" })).toBeVisible();

    await page.getByRole("heading", { name: "Yes Kanban" }).click();

    await expect(page.getByTestId("column-name").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveClass(/bg-primary/);
  });

  test("can navigate to dashboard", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "Dashboard" }).click();

    await expect(page.getByTestId("dashboard-wrapper")).toBeVisible();
    await expect(page.getByText("Cumulative Flow")).toBeVisible();
  });

  test("issue detail URL persists across page refresh", async ({ page }) => {
    await ensureBoardWithIssue(page);

    const issueCard = page.getByTestId("issue-card").first();
    await issueCard.click();
    await expect(page.getByTestId("issue-detail-panel")).toBeVisible();

    const simpleId = await page.getByTestId("issue-detail-simple-id").innerText();

    const url = page.url();
    expect(url).toContain(simpleId);

    await page.reload();
    await page.waitForTimeout(1500);

    await expect(page.getByTestId("issue-detail-panel")).toBeVisible();
    await expect(page.getByTestId("issue-detail-simple-id")).toHaveText(simpleId);
  });

  test("ESC closes create project dialog", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);

    const addBtn = page.getByTestId("project-sidebar-add");
    if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addBtn.click();
    } else {
      await page.getByRole("button", { name: "Create Project" }).click();
    }

    const projectDialogBackdrop = page.locator('[data-slot="dialog-overlay"]');
    await expect(projectDialogBackdrop).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(projectDialogBackdrop).toBeHidden({ timeout: 5000 });
  });

  test("ESC closes create issue dialog", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByTestId("column-add-btn").first().click();
    const issueDialogBackdrop = page.locator('[data-slot="dialog-overlay"]');
    await expect(issueDialogBackdrop).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(issueDialogBackdrop).toBeHidden({ timeout: 5000 });
  });

  test("ESC closes issue detail panel", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByTestId("issue-card").first().click();
    await expect(page.getByTestId("issue-detail-panel")).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("issue-detail-panel")).toBeHidden({ timeout: 5000 });
  });

  test("list view issue detail URL persists across page refresh", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByTestId("list-view")).toBeVisible();

    const tableRow = page.getByTestId("list-table").locator("tbody tr").first();
    await tableRow.click();
    await expect(page.getByTestId("issue-detail-panel")).toBeVisible();

    const simpleId = await page.getByTestId("issue-detail-simple-id").innerText();
    expect(page.url()).toContain(simpleId);

    await page.reload();
    await page.waitForTimeout(1500);

    await expect(page.getByTestId("issue-detail-panel")).toBeVisible();
    await expect(page.getByTestId("issue-detail-simple-id")).toHaveText(simpleId);
  });
});
