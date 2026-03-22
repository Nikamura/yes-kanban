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

  it("formats priority set (no previous value)", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "priority",
        newValue: JSON.stringify("high"),
      })
    ).toBe("Priority set to high");
  });

  it("formats priority change", () => {
    expect(
      formatHistoryEntry({
        action: "updated",
        field: "priority",
        oldValue: JSON.stringify("low"),
        newValue: JSON.stringify("high"),
      })
    ).toBe("Priority changed from low → high");
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

  it("formats title change", () => {
    expect(formatHistoryEntry({ action: "updated", field: "title" })).toBe("Title changed");
  });

  it("formats description update", () => {
    expect(formatHistoryEntry({ action: "updated", field: "description" })).toBe(
      "Description updated"
    );
  });

  it("formats blockers update", () => {
    expect(formatHistoryEntry({ action: "updated", field: "blockedBy" })).toBe("Blockers updated");
  });

  it("formats unknown field", () => {
    expect(formatHistoryEntry({ action: "updated", field: "foo" })).toBe("foo updated");
  });

  it("formats setting a due date", () => {
    const ts = new Date(2025, 5, 15).getTime();
    const result = formatHistoryEntry({
      action: "updated",
      field: "dueDate",
      oldValue: undefined,
      newValue: JSON.stringify(ts),
    });
    expect(result).toContain("Due date set to");
  });

  it("formats removing a due date", () => {
    const ts = new Date(2025, 5, 15).getTime();
    const result = formatHistoryEntry({
      action: "updated",
      field: "dueDate",
      oldValue: JSON.stringify(ts),
      newValue: undefined,
    });
    expect(result).toBe("Due date removed");
  });

  it("formats changing a due date", () => {
    const old = new Date(2025, 5, 15).getTime();
    const next = new Date(2025, 6, 1).getTime();
    const result = formatHistoryEntry({
      action: "updated",
      field: "dueDate",
      oldValue: JSON.stringify(old),
      newValue: JSON.stringify(next),
    });
    expect(result).toContain("Due date changed to");
  });

  it("does not treat timestamp 0 as removed", () => {
    const result = formatHistoryEntry({
      action: "updated",
      field: "dueDate",
      oldValue: undefined,
      newValue: JSON.stringify(0),
    });
    expect(result).toContain("Due date set to");
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
