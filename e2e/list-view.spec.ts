import { test, expect } from "@playwright/test";
import { ensureBoardWithIssue, seedProjectWithIssue } from "./helpers";

test.describe("List View", () => {
  test("shows list view with table headers", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "List" }).click();

    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /ID/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Title/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Status/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Priority/i })).toBeVisible();
  });

  test("can search issues in list view", async ({ page }) => {
    const { slug } = await seedProjectWithIssue();
    await page.goto(`/#/${slug}/list`);

    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Implement user authentication" })).toBeVisible();

    // Search for the seed issue
    await page.getByPlaceholder("Search issues...").fill("authentication");

    // Should filter to matching issues
    await expect(page.getByRole("cell", { name: "Implement user authentication" })).toBeVisible();
    const count = page.locator(".list-count");
    await expect(count).toContainText("1");
  });

  test("can filter by priority in list view", async ({ page }) => {
    const { slug } = await seedProjectWithIssue();
    await page.goto(`/#/${slug}/list`);

    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Implement user authentication" })).toBeVisible();

    // Filter by high priority
    await page.locator(".list-filters select").nth(1).selectOption("high");

    // Should show only high priority issues
    await expect(page.getByRole("cell", { name: "Implement user authentication" })).toBeVisible();
    const count = page.locator(".list-count");
    await expect(count).toContainText("1");
  });

  test("can sort by column", async ({ page }) => {
    await ensureBoardWithIssue(page);

    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("table")).toBeVisible();

    // Click ID column to sort ascending
    await page.getByRole("columnheader", { name: /ID/i }).click();

    // First row should contain the first issue ID
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow.locator("td").first()).toContainText("-1");
  });

  test("can switch between board and list views", async ({ page }) => {
    await ensureBoardWithIssue(page);

    // Go to list
    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("table")).toBeVisible();

    // Go back to board
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.locator(".board-columns")).toBeVisible();
  });
});
