import { test, expect } from "@playwright/test";
import { seedGrillingWorkspace } from "./helpers";

test.describe("Grill Me pre-planning interview", () => {
  test("grilling workspace shows question, user answers, lifecycle auto-continues", async ({
    page,
  }) => {
    const { slug, issueSimpleId, workspaceId, suggestions } = await seedGrillingWorkspace();
    const [firstSuggestion] = suggestions;

    await page.goto(`/#/${slug}/board/${issueSimpleId}/ws/${workspaceId}`);

    await expect(page.getByTestId("workspace-panel")).toBeVisible({ timeout: 20_000 });

    const panel = page.getByTestId("workspace-panel");
    const grillingOrWaiting = panel.locator(
      '[data-testid="ws-status"][data-status="grilling"], [data-testid="ws-status"][data-status="waiting_for_answer"]',
    );
    await expect(grillingOrWaiting).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("tab", { name: /Plan \(1\)/ })).toBeVisible({
      timeout: 20_000,
    });

    await expect(page.locator('[data-testid="ws-question"][data-status="pending"]')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("ws-question-suggestion").filter({ hasText: firstSuggestion }).click();
    await expect(page.getByTestId("ws-question-input")).toHaveValue(firstSuggestion);

    await page.getByRole("button", { name: "Answer", exact: true }).click();

    await expect(panel.locator('[data-testid="ws-status"][data-status="waiting_for_answer"]')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(panel.locator('[data-testid="ws-status"][data-status="creating"]')).toBeVisible({ timeout: 20_000 });

    await page.getByRole("tab", { name: /Plan/ }).click();

    await expect(page.locator('[data-testid="ws-question"][data-status="pending"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ws-question"][data-status="answered"]')).toBeVisible();
  });
});
