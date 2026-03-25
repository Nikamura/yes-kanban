const DESC_PREVIEW_LEN = 80;

function truncateForHistory(s: string, maxLen = DESC_PREVIEW_LEN): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function quoteDisplay(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

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

  if (entry.action === "archived") {
    return "Issue archived";
  }

  if (entry.action === "unarchived") {
    return "Issue restored from archive";
  }

  if (entry.action === "moved") {
    return `Status changed from ${oldVal} → ${newVal}`;
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
    const oldStr = oldVal !== undefined && oldVal !== null ? String(oldVal) : undefined;
    const newStr = newVal !== undefined && newVal !== null ? String(newVal) : "";
    if (oldStr === undefined) return `Title set to ${quoteDisplay(newStr)}`;
    return `Title changed from ${quoteDisplay(oldStr)} → ${quoteDisplay(newStr)}`;
  }

  if (entry.field === "description") {
    const oldStr = oldVal !== undefined && oldVal !== null ? String(oldVal) : "";
    const newStr = newVal !== undefined && newVal !== null ? String(newVal) : "";
    return `Description updated (was: ${quoteDisplay(truncateForHistory(oldStr))} → ${quoteDisplay(truncateForHistory(newStr))})`;
  }

  if (entry.field === "comment") {
    const detail = newVal as { action?: string; author?: string; body?: string } | null;
    if (detail && typeof detail === "object" && detail.action) {
      const body = truncateForHistory(detail.body ?? "");
      if (detail.action === "add") {
        const by = detail.author ? ` by ${detail.author}` : "";
        return `Comment added${by}: ${quoteDisplay(body)}`;
      }
      if (detail.action === "remove") {
        return `Comment removed: ${quoteDisplay(body)}`;
      }
    }
    return "Comment updated";
  }

  if (entry.field === "attachment") {
    const detail = newVal as { action?: string; filename?: string } | null;
    if (detail && typeof detail === "object" && detail.action && detail.filename) {
      if (detail.action === "add") return `Attachment added: ${quoteDisplay(detail.filename)}`;
      if (detail.action === "remove") return `Attachment removed: ${quoteDisplay(detail.filename)}`;
    }
    return "Attachment updated";
  }

  if (entry.field === "blockedBy") {
    return `Blockers updated`;
  }

  if (entry.field === "deepResearch") {
    if (newVal === true) return "Deep research enabled";
    if (newVal === false) return "Deep research disabled";
  }

  if (entry.field === "grillMe") {
    if (newVal === true) return "Grill me enabled";
    if (newVal === false) return "Grill me disabled";
  }

  if (entry.field === "autoMerge") {
    if (newVal === true) return "Auto merge enabled";
    if (newVal === false) return "Auto merge disabled";
  }

  return `${entry.field} updated`;
}
