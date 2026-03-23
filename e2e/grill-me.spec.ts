import { test, expect } from "@playwright/test";
import { seedGrillingWorkspace } from "./helpers";

test.describe("Grill Me pre-planning interview", () => {
  test("grilling workspace shows question, user answers, lifecycle auto-continues", async ({
    page,
  }) => {
    const { slug, issueSimpleId, workspaceId, suggestions } = await seedGrillingWorkspace();
    const [firstSuggestion] = suggestions;

    await page.goto(`/#/${slug}/board/${issueSimpleId}/ws/${workspaceId}`);

    await expect(page.locator(".workspace-panel")).toBeVisible({ timeout: 20_000 });

    const panel = page.locator(".workspace-panel");
    const grillingOrWaiting = panel.locator(".ws-status-grilling, .ws-status-waiting_for_answer");
    await expect(grillingOrWaiting).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("button", { name: /Plan \(1\)/ })).toBeVisible({
      timeout: 20_000,
    });

    await expect(page.locator(".ws-question.pending")).toBeVisible({ timeout: 20_000 });

    await page.locator(".ws-question-suggestion").filter({ hasText: firstSuggestion }).click();
    await expect(page.locator(".ws-question-input")).toHaveValue(firstSuggestion);

    await page.getByRole("button", { name: "Answer", exact: true }).click();

    await expect(panel.locator(".ws-status-waiting_for_answer")).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(panel.locator(".ws-status-creating")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /Plan/ }).click();

    await expect(page.locator(".ws-question.pending")).toHaveCount(0);
    await expect(page.locator(".ws-question.answered")).toBeVisible();
  });
});
