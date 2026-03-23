import { test, expect } from "@playwright/test";
import { seedWorkspaceWithPendingQuestion } from "./helpers";

test.describe("Workspace agent questions", () => {
  test("suggested answers prefill the textarea without auto-submit", async ({ page }) => {
    const { slug, issueSimpleId, workspaceId, suggestions } = await seedWorkspaceWithPendingQuestion();
    const [a, b] = suggestions;

    await page.goto(`/#/${slug}/board/${issueSimpleId}/ws/${workspaceId}`);

    await expect(page.locator(".workspace-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".ws-question.pending")).toBeVisible({ timeout: 20_000 });

    const input = page.locator(".ws-question-input");
    const suggestionA = page.locator(".ws-question-suggestion").filter({ hasText: a });
    const suggestionB = page.locator(".ws-question-suggestion").filter({ hasText: b });

    await suggestionA.click();
    await expect(input).toHaveValue(a);
    await expect(page.locator(".ws-question.pending .ws-question-answer-form")).toBeVisible();

    await input.fill(`${a} — user addition`);
    await expect(input).toHaveValue(`${a} — user addition`);

    await suggestionB.click();
    await expect(input).toHaveValue(b);

    await input.fill(`${b} — final`);
    await page.getByRole("button", { name: "Answer", exact: true }).click();

    // Answering clears pending questions and may move the workspace off awaiting_feedback;
    // the UI then defaults to Logs, so Plan content (including answered questions) is unmounted until Plan is opened.
    await page.getByRole("button", { name: /Plan/ }).click();

    await expect(page.locator(".ws-question.pending")).toHaveCount(0);
    await expect(page.locator(".ws-question.answered")).toBeVisible();
    await expect(page.locator(".ws-question-answer-form")).toHaveCount(0);
  });
});
