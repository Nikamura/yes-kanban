export function formatHistoryEntry(entry: {
  action: string;
  field: string;
  oldValue?: string;
  newValue?: string;
}) {
  const parse = (v?: string) => {
    if (v === undefined) return undefined;
    try { return JSON.parse(v); } catch { return v; }
  };

  const oldVal = parse(entry.oldValue);
  const newVal = parse(entry.newValue);

  if (entry.action === "created") {
    return "Issue created";
  }

  if (entry.action === "moved") {
    return `Status changed from ${oldVal} → ${newVal}`;
  }

  if (entry.field === "priority") {
    if (!oldVal) return `Priority set to ${newVal}`;
    return `Priority changed from ${oldVal} → ${newVal}`;
  }

  if (entry.field === "tags") {
    const oldTags: string[] = Array.isArray(oldVal) ? oldVal : [];
    const newTags: string[] = Array.isArray(newVal) ? newVal : [];
    const added = newTags.filter((t) => !oldTags.includes(t));
    const removed = oldTags.filter((t) => !newTags.includes(t));
    const parts: string[] = [];
    if (added.length > 0) parts.push(`added: ${added.join(", ")}`);
    if (removed.length > 0) parts.push(`removed: ${removed.join(", ")}`);
    return `Tags ${parts.join("; ")}`;
  }

  if (entry.field === "title") {
    return `Title changed`;
  }

  if (entry.field === "description") {
    return `Description updated`;
  }

  if (entry.field === "checklist") {
    const detail = newVal as { action?: string; text?: string } | null;
    if (detail && typeof detail === "object") {
      switch (detail.action) {
        case "add": return `Checklist: added "${detail.text}"`;
        case "remove": return `Checklist: removed "${detail.text}"`;
        case "check": return `Checklist: checked "${detail.text}"`;
        case "uncheck": return `Checklist: unchecked "${detail.text}"`;
        case "reorder": return `Checklist: reordered`;
        case "edit": {
          const oldDetail = oldVal as { text?: string } | null;
          if (oldDetail && typeof oldDetail === "object" && oldDetail.text) {
            return `Checklist: "${oldDetail.text}" → "${detail.text}"`;
          }
          return `Checklist: edited "${detail.text}"`;
        }
      }
    }
    return `Checklist updated`;
  }

  if (entry.field === "blockedBy") {
    return `Blockers updated`;
  }

  if (entry.field === "dueDate") {
    if (newVal === undefined || newVal === null) return `Due date removed`;
    const dateStr = new Date(newVal as number).toLocaleDateString();
    if (oldVal === undefined || oldVal === null) return `Due date set to ${dateStr}`;
    return `Due date changed to ${dateStr}`;
  }

  return `${entry.field} updated`;
}
