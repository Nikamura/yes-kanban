import { describe, test, expect } from "bun:test";
import { recoverOrphanedWorkspaces, shouldRequeueOnShutdown } from "./graceful-restart";

describe("graceful-restart", () => {
  describe("recoverOrphanedWorkspaces", () => {
    test("resets lifecycle statuses to creating for re-dispatch", () => {
      const lifecycleStatuses = ["claimed", "planning", "grilling", "coding", "testing", "reviewing"];
      const updates: Array<{ id: string; status: string }> = [];

      for (const status of lifecycleStatuses) {
        const result = recoverOrphanedWorkspaces([
          { _id: `ws-${status}`, status } as any,
        ]);
        updates.push(...result);
      }

      expect(updates).toHaveLength(lifecycleStatuses.length);
      for (const update of updates) {
        expect(update.status).toBe("creating");
      }
    });

    test("preserves manual action statuses (awaiting_feedback, waiting_for_answer, rebasing, creating_pr, merging)", () => {
      const manualStatuses = ["awaiting_feedback", "waiting_for_answer", "rebasing", "creating_pr", "merging"];

      for (const status of manualStatuses) {
        const result = recoverOrphanedWorkspaces([
          { _id: `ws-${status}`, status } as any,
        ]);
        // These should NOT produce any updates — their poll handlers will pick them up
        expect(result).toHaveLength(0);
      }
    });

    test("ignores workspaces in terminal states", () => {
      const terminalStatuses = ["completed", "merged", "failed", "conflict", "test_failed", "changes_requested", "cancelled", "pr_open"];
      const result = recoverOrphanedWorkspaces(
        terminalStatuses.map((status) => ({ _id: `ws-${status}`, status } as any)),
      );
      expect(result).toHaveLength(0);
    });

    test("returns empty array for empty input", () => {
      expect(recoverOrphanedWorkspaces([])).toHaveLength(0);
    });
  });

  describe("shouldRequeueOnShutdown", () => {
    test("returns true for in-progress statuses", () => {
      const inProgress = ["claimed", "planning", "grilling", "coding", "testing", "reviewing", "awaiting_feedback", "waiting_for_answer"];
      for (const status of inProgress) {
        expect(shouldRequeueOnShutdown(status)).toBe(true);
      }
    });

    test("returns false for terminal statuses", () => {
      const terminal = ["completed", "merged", "failed"];
      for (const status of terminal) {
        expect(shouldRequeueOnShutdown(status)).toBe(false);
      }
    });
  });
});
