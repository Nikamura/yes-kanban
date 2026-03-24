import { test, expect, type Page } from "@playwright/test";
import { seedWorkspaceWithDiff } from "./helpers";

test.describe("Diff viewer", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  let slug: string;
  let issueSimpleId: string;
  let workspaceId: string;

  test.beforeAll(async () => {
    const seeded = await seedWorkspaceWithDiff();
    slug = seeded.slug;
    issueSimpleId = seeded.issueSimpleId;
    workspaceId = seeded.workspaceId;
  });

  async function openDiffTab(page: Page) {
    await page.goto(`/#/${slug}/board/${issueSimpleId}/ws/${workspaceId}`);
    await expect(page.locator(".workspace-panel")).toBeVisible({ timeout: 20_000 });
    await page.locator(".ws-tab").filter({ hasText: "Diff" }).click();
    await expect(page.locator(".diff-toolbar")).toBeVisible({ timeout: 15_000 });
  }

  test("toolbar shows unified/split toggle and expand/collapse buttons", async ({ page }) => {
    await openDiffTab(page);

    const toolbar = page.locator(".diff-toolbar");
    await expect(toolbar).toBeVisible();

    const unifiedBtn = page.getByRole("button", { name: "Unified", exact: true });
    const splitBtn = page.getByRole("button", { name: "Split", exact: true });
    await expect(unifiedBtn).toHaveClass(/is-active/);
    await expect(splitBtn).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand all" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse all" })).toBeVisible();
  });

  test("file sections show path, status badge, and stats", async ({ page }) => {
    await openDiffTab(page);

    const headers = page.locator(".diff-file-section-header");
    await expect(headers).toHaveCount(3);

    await expect(page.locator(".diff-file-section-path").filter({ hasText: "src/utils.ts" })).toBeVisible();
    await expect(page.locator(".diff-file-section-path").filter({ hasText: "src/newFile.ts" })).toBeVisible();
    await expect(page.locator(".diff-file-section-path").filter({ hasText: "src/removed.ts" })).toBeVisible();

    await expect(page.locator(".diff-file-status").filter({ hasText: "M" })).toHaveCount(1);
    await expect(page.locator(".diff-file-status").filter({ hasText: "A" })).toHaveCount(1);
    await expect(page.locator(".diff-file-status").filter({ hasText: "D" })).toHaveCount(1);

    await expect(page.locator(".diff-stat-add")).toHaveCount(2);
    await expect(page.locator(".diff-stat-del")).toHaveCount(2);
  });

  test("collapse all hides file content, expand all restores it", async ({ page }) => {
    await openDiffTab(page);

    await expect(page.locator(".diff-line")).not.toHaveCount(0);

    await page.getByRole("button", { name: "Collapse all" }).click();

    const headers = page.locator(".diff-file-section-header");
    await expect(headers).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(headers.nth(i)).toHaveAttribute("aria-expanded", "false");
    }
    await expect(page.locator(".diff-line")).toHaveCount(0);

    await page.getByRole("button", { name: "Expand all" }).click();

    for (let i = 0; i < 3; i++) {
      await expect(headers.nth(i)).toHaveAttribute("aria-expanded", "true");
    }
    await expect(page.locator(".diff-line").first()).toBeVisible();
  });

  test("clicking a file header toggles collapse for that file", async ({ page }) => {
    await openDiffTab(page);

    const headers = page.locator(".diff-file-section-header");
    const first = headers.first();
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(headers.nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(headers.nth(2)).toHaveAttribute("aria-expanded", "true");

    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
  });

  test("switching to split mode changes layout", async ({ page }) => {
    await openDiffTab(page);

    await expect(page.locator(".diff-line").first()).toBeVisible();

    await page.getByRole("button", { name: "Split", exact: true }).click();

    await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveClass(/is-active/);
    await expect(page.getByRole("button", { name: "Unified", exact: true })).not.toHaveClass(/is-active/);
    await expect(page.locator(".diff-split-line").first()).toBeVisible();

    await page.getByRole("button", { name: "Unified", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unified", exact: true })).toHaveClass(/is-active/);
    await expect(page.locator(".diff-line").first()).toBeVisible();
  });

  test("horizontal scroll is available for wide content", async ({ page }) => {
    await openDiffTab(page);

    const widePre = page
      .locator(".diff-file-section")
      .filter({ hasText: "src/newFile.ts" })
      .locator(".diff-unified-pre")
      .first();
    const overflow = await widePre.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  });
});
