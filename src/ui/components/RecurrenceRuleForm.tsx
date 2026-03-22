import { useState } from "react";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { describeCron, validateCron, CRON_PRESETS } from "../../../convex/lib/cronParser";

type Column = Doc<"columns">;

interface RecurrenceRuleFormProps {
  projectId: Id<"projects">;
  columns: Column[];
  onSubmit: (data: {
    title: string;
    description: string;
    priority?: string;
    tags: string[];
    targetColumn: string;
    triggerMode: "fixed" | "on_completion";
    cronExpression?: string;
  }) => void;
  onCancel: () => void;
  initial?: {
    title: string;
    description: string;
    priority?: string;
    tags: string[];
    targetColumn: string;
    triggerMode: "fixed" | "on_completion";
    cronExpression?: string;
  };
}

export function RecurrenceRuleForm({
  columns,
  onSubmit,
  onCancel,
  initial,
}: RecurrenceRuleFormProps) {
  const visibleColumns = columns
    .filter((c) => c.visible)
    .sort((a, b) => a.position - b.position);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "");
  const [tagsStr, setTagsStr] = useState(initial?.tags.join(", ") ?? "");
  const [targetColumn, setTargetColumn] = useState(
    initial?.targetColumn ?? visibleColumns[0]?.name ?? ""
  );
  const [triggerMode, setTriggerMode] = useState<"fixed" | "on_completion">(
    initial?.triggerMode ?? "fixed"
  );
  const [cronPreset, setCronPreset] = useState(() => {
    if (!initial?.cronExpression) return "daily";
    const found = Object.entries(CRON_PRESETS).find(
      ([, v]) => v === initial.cronExpression
    );
    return found ? found[0] : "custom";
  });
  const [customCron, setCustomCron] = useState(initial?.cronExpression ?? "");

  const cronExpression =
    triggerMode === "fixed"
      ? cronPreset === "custom"
        ? customCron
        : CRON_PRESETS[cronPreset]
      : undefined;

  const cronError =
    triggerMode === "fixed" && cronExpression
      ? validateCron(cronExpression)
      : null;

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (triggerMode === "fixed" && cronError) return;

    onSubmit({
      title: title.trim(),
      description,
      priority: priority || undefined,
      tags: tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      targetColumn,
      triggerMode,
      cronExpression,
    });
  };

  return (
    <form className="inline-form template-form" onSubmit={handleSubmit}>
      <div className="template-form-row">
        <input
          placeholder="Title (supports {{date}}, {{seq}})"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoComplete="off"
        />
      </div>
      <textarea
        className="template-textarea"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
      />
      <div className="template-form-row">
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">No priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          placeholder="Tags (comma separated)"
          value={tagsStr}
          onChange={(e) => setTagsStr(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="template-form-row">
        <select
          value={targetColumn}
          onChange={(e) => setTargetColumn(e.target.value)}
        >
          {visibleColumns.map((c) => (
            <option key={c._id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={triggerMode}
          onChange={(e) =>
            setTriggerMode(e.target.value as "fixed" | "on_completion")
          }
        >
          <option value="fixed">Fixed schedule</option>
          <option value="on_completion">On completion</option>
        </select>
      </div>
      {triggerMode === "fixed" && (
        <div className="template-form-row">
          <select
            value={cronPreset}
            onChange={(e) => setCronPreset(e.target.value)}
          >
            <option value="daily">Daily (9:00 UTC)</option>
            <option value="weekly">Weekly (Mon 9:00 UTC)</option>
            <option value="monthly">Monthly (1st, 9:00 UTC)</option>
            <option value="custom">Custom cron</option>
          </select>
          {cronPreset === "custom" && (
            <input
              placeholder="e.g. 0 9 * * 1-5"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              autoComplete="off"
            />
          )}
        </div>
      )}
      {triggerMode === "fixed" && cronExpression && !cronError && (
        <div className="settings-hint" style={{ margin: "0.25rem 0" }}>
          {describeCron(cronExpression)}
        </div>
      )}
      {cronError && (
        <div
          className="settings-hint"
          style={{ margin: "0.25rem 0", color: "var(--danger)" }}
        >
          {cronError}
        </div>
      )}
      <div className="template-form-row">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!title.trim() || (triggerMode === "fixed" && !!cronError)}
        >
          {initial ? "Save" : "Add"}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
