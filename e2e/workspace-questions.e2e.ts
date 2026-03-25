import { test, expect } from "@playwright/test";
import { seedWorkspaceWithPendingQuestion } from "./helpers";

test.describe("Workspace agent questions", () => {
  test("suggested answers prefill the textarea without auto-submit", async ({ page }) => {
    const { slug, issueSimpleId, workspaceId, suggestions } = await seedWorkspaceWithPendingQuestion();
    const [a, b] = suggestions;

    await page.goto(`/#/${slug}/board/${issueSimpleId}/ws/${workspaceId}`);

    await expect(page.getByTestId("workspace-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="ws-question"][data-status="pending"]')).toBeVisible({ timeout: 20_000 });

    const input = page.getByTestId("ws-question-input");
    const suggestionA = page.getByTestId("ws-question-suggestion").filter({ hasText: a });
    const suggestionB = page.getByTestId("ws-question-suggestion").filter({ hasText: b });

    await suggestionA.click();
    await expect(input).toHaveValue(a);
    await expect(page.getByTestId("ws-question-answer-form")).toBeVisible();

    await input.fill(`${a} — user addition`);
    await expect(input).toHaveValue(`${a} — user addition`);

    await suggestionB.click();
    await expect(input).toHaveValue(b);

    await input.fill(`${b} — final`);
    await page.getByRole("button", { name: "Answer", exact: true }).click();

    await page.getByRole("tab", { name: /Plan/ }).click();

    await expect(page.locator('[data-testid="ws-question"][data-status="pending"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ws-question"][data-status="answered"]')).toBeVisible();
    await expect(page.getByTestId("ws-question-answer-form")).toHaveCount(0);
  });
});
