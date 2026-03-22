import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { RecurrenceRuleForm } from "./RecurrenceRuleForm";
import { describeCron } from "../../../convex/lib/cronParser";

export function RecurrenceRulesSection({ projectId }: { projectId: Id<"projects"> }) {
  const rules = useQuery(api.recurrenceRules.list, { projectId });
  const columns = useQuery(api.columns.list, { projectId });
  const createRule = useMutation(api.recurrenceRules.create);
  const updateRule = useMutation(api.recurrenceRules.update);
  const pauseRule = useMutation(api.recurrenceRules.pause);
  const resumeRule = useMutation(api.recurrenceRules.resume);
  const removeRule = useMutation(api.recurrenceRules.remove);

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<Id<"recurrenceRules"> | null>(null);

  return (
    <section className="settings-section">
      <h2>
        Recurring Tasks
        <button className="btn btn-sm" onClick={() => setShowAdd(!showAdd)}>
          + Add
        </button>
      </h2>
      <p className="settings-hint">
        Automatically create repeating tasks on a schedule or when the previous one completes.
        Use {"{{date}}"} and {"{{seq}}"} in titles for dynamic values.
      </p>

      {showAdd && columns && (
        <RecurrenceRuleForm
          projectId={projectId}
          columns={columns}
          onSubmit={async (data) => {
            await createRule({ projectId, ...data });
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {rules?.map((rule) => (
        <div key={rule._id} className="settings-row template-row">
          {editingId === rule._id && columns ? (
            <RecurrenceRuleForm
              projectId={projectId}
              columns={columns}
              initial={{
                title: rule.title,
                description: rule.description,
                priority: rule.priority,
                tags: rule.tags,
                targetColumn: rule.targetColumn,
                triggerMode: rule.triggerMode,
                cronExpression: rule.cronExpression,
              }}
              onSubmit={async (data) => {
                await updateRule({ id: rule._id, ...data });
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="template-row-display">
              <span>{rule.title}</span>
              <span className="meta-value">
                {rule.triggerMode === "fixed" && rule.cronExpression
                  ? describeCron(rule.cronExpression)
                  : "On completion"}
              </span>
              <span className="meta-value">→ {rule.targetColumn}</span>
              <span
                className={`meta-value ${rule.status === "paused" ? "text-muted" : ""}`}
              >
                {rule.status === "paused" ? "Paused" : `#${rule.spawnCount} spawned`}
              </span>
              {rule.status === "active" ? (
                <button
                  className="btn btn-sm"
                  onClick={() => void pauseRule({ id: rule._id })}
                >
                  Pause
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void resumeRule({ id: rule._id })}
                >
                  Resume
                </button>
              )}
              <button
                className="btn btn-sm template-edit-btn"
                onClick={() => setEditingId(rule._id)}
              >
                Edit
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  if (window.confirm(`Delete recurrence rule "${rule.title}"?`)) {
                    void removeRule({ id: rule._id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
