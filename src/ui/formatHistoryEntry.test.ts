import { describe, it, expect } from "bun:test";
import { formatHistoryEntry } from "./formatHistoryEntry";

describe("formatHistoryEntry", () => {
  it("formats created action", () => {
    expect(formatHistoryEntry({ action: "created", field: "issue" })).toBe("Issue created");
  });

  it("formats status move", () => {
    expect(
      formatHistoryEntry({
        action: "moved",
        field: "status",
        oldValue: JSON.stringify("To Do"),
        newValue: JSON.stringify("In Progress"),
      })
    ).toBe("Status changed from To Do → In Progress");
  });

  it("formats tags added", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "tags",
        oldValue: JSON.stringify(["a"]),
        newValue: JSON.stringify(["a", "b", "c"]),
      })
    ).toBe("Tags added: b, c");
  });

  it("formats tags removed", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "tags",
        oldValue: JSON.stringify(["a", "b"]),
        newValue: JSON.stringify(["a"]),
      })
    ).toBe("Tags removed: b");
  });

  it("formats tags added and removed", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "tags",
        oldValue: JSON.stringify(["a", "b"]),
        newValue: JSON.stringify(["a", "c"]),
      })
    ).toBe("Tags added: c; removed: b");
  });

  it("formats title set (no previous value)", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "title",
        newValue: JSON.stringify("Next"),
      })
    ).toBe('Title set to "Next"');
  });

  it("formats title change with old and new", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "title",
        oldValue: JSON.stringify("A"),
        newValue: JSON.stringify("B"),
      })
    ).toBe('Title changed from "A" → "B"');
  });

  it("formats description update with truncated preview", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "description",
        oldValue: JSON.stringify("first"),
        newValue: JSON.stringify("second"),
      })
    ).toBe('Description updated (was: "first" → "second")');
  });

  it("truncates long description previews in history text", () => {
    const long = "x".repeat(100);
    const result = formatHistoryEntry({
      action: "updated",
      field: "description",
      oldValue: JSON.stringify(long),
      newValue: JSON.stringify("b"),
    });
    expect(result).toContain("…");
    expect(result.length).toBeLessThan(long.length + 80);
  });

  it("formats deepResearch enabled and disabled", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "deepResearch",
        oldValue: JSON.stringify(false),
        newValue: JSON.stringify(true),
      })
    ).toBe("Deep research enabled");
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "deepResearch",
        oldValue: JSON.stringify(true),
        newValue: JSON.stringify(false),
      })
    ).toBe("Deep research disabled");
  });

  it("formats grillMe enabled and disabled", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "grillMe",
        oldValue: JSON.stringify(false),
        newValue: JSON.stringify(true),
      })
    ).toBe("Grill me enabled");
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "grillMe",
        oldValue: JSON.stringify(true),
        newValue: JSON.stringify(false),
      })
    ).toBe("Grill me disabled");
  });

  it("formats autoMerge enabled and disabled", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "autoMerge",
        oldValue: JSON.stringify(false),
        newValue: JSON.stringify(true),
      })
    ).toBe("Auto merge enabled");
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "autoMerge",
        oldValue: JSON.stringify(true),
        newValue: JSON.stringify(false),
      })
    ).toBe("Auto merge disabled");
  });

  it("formats comment added and removed", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "comment",
        newValue: JSON.stringify({
          action: "add",
          author: "alice",
          body: "Hello",
        }),
      })
    ).toBe('Comment added by alice: "Hello"');
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "comment",
        newValue: JSON.stringify({
          action: "remove",
          body: "Gone",
        }),
      })
    ).toBe('Comment removed: "Gone"');
  });

  it("formats attachment added and removed", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "attachment",
        newValue: JSON.stringify({ action: "add", filename: "notes.txt" }),
      })
    ).toBe('Attachment added: "notes.txt"');
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "attachment",
        newValue: JSON.stringify({ action: "remove", filename: "old.png" }),
      })
    ).toBe('Attachment removed: "old.png"');
  });

  it("formats blockers update", () => {
    expect(formatHistoryEntry({ action: "updated", field: "blockedBy" })).toBe("Blockers updated");
  });

  it("formats unknown field", () => {
    expect(formatHistoryEntry({ action: "updated", field: "foo" })).toBe("foo updated");
  });

  it("formats checklist item added", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
        newValue: JSON.stringify({ action: "add", text: "Buy milk" }),
      })
    ).toBe('Checklist: added "Buy milk"');
  });

  it("formats checklist item removed", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
        newValue: JSON.stringify({ action: "remove", text: "Buy milk" }),
      })
    ).toBe('Checklist: removed "Buy milk"');
  });

  it("formats checklist item checked", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
        newValue: JSON.stringify({ action: "check", text: "Buy milk" }),
      })
    ).toBe('Checklist: checked "Buy milk"');
  });

  it("formats checklist item unchecked", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
        newValue: JSON.stringify({ action: "uncheck", text: "Buy milk" }),
      })
    ).toBe('Checklist: unchecked "Buy milk"');
  });

  it("formats checklist reorder", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
        newValue: JSON.stringify({ action: "reorder" }),
      })
    ).toBe("Checklist: reordered");
  });

  it("formats checklist item text edit with old value", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
        oldValue: JSON.stringify({ text: "Buy milk" }),
        newValue: JSON.stringify({ action: "edit", text: "Buy oat milk" }),
      })
    ).toBe('Checklist: "Buy milk" → "Buy oat milk"');
  });

  it("formats checklist item text edit without old value", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
        newValue: JSON.stringify({ action: "edit", text: "Buy oat milk" }),
      })
    ).toBe('Checklist: edited "Buy oat milk"');
  });

  it("formats checklist with no detail as generic", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "checklist",
      })
    ).toBe("Checklist updated");
  });

  it("formats archived action", () => {
    expect(
      formatHistoryEntry({
        action: "archived",
        field: "archivedAt",
        newValue: JSON.stringify(Date.now()),
      })
    ).toBe("Issue archived");
  });

  it("formats unarchived action", () => {
    expect(
      formatHistoryEntry({
        action: "unarchived",
        field: "archivedAt",
        oldValue: JSON.stringify(Date.now()),
      })
    ).toBe("Issue restored from archive");
  });
});
