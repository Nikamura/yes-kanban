import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

const CATEGORIES = ["bug", "feature", "refactor", "docs"] as const;

export function IssueTemplatesSection({ projectId }: { projectId: Id<"projects"> }) {
  const templates = useQuery(api.issueTemplates.list, { projectId });
  const createTemplate = useMutation(api.issueTemplates.create);
  const updateTemplate = useMutation(api.issueTemplates.update);
  const removeTemplate = useMutation(api.issueTemplates.remove);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    descriptionTemplate: "",
    defaultTags: "",
    category: "",
  });
  const [editingId, setEditingId] = useState<Id<"issueTemplates"> | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    descriptionTemplate: "",
    defaultTags: "",
    category: "",
  });

  return (
    <section className="settings-section">
      <h2>
        Issue Templates
        <button className="btn btn-sm" onClick={() => setShowAdd(!showAdd)}>
          + Add
        </button>
      </h2>
      <p className="settings-hint">
        Templates pre-fill issue fields when creating new issues.
      </p>

      {showAdd && (
        <form
          className="inline-form template-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            await createTemplate({
              projectId,
              name: form.name.trim(),
              descriptionTemplate: form.descriptionTemplate,
              defaultTags: form.defaultTags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              category: form.category || undefined,
            });
            setForm({ name: "", descriptionTemplate: "", defaultTags: "", category: "" });
            setShowAdd(false);
          }}
        >
          <div className="template-form-row">
            <input
              placeholder="Template name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoComplete="off"
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">No category</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <textarea
            className="template-textarea"
            placeholder="Description template (Markdown)"
            value={form.descriptionTemplate}
            onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })}
            rows={4}
          />
          <div className="template-form-row">
            <input
              placeholder="Default tags (comma separated)"
              value={form.defaultTags}
              onChange={(e) => setForm({ ...form, defaultTags: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="template-form-row">
            <button type="submit" className="btn btn-primary btn-sm" disabled={!form.name.trim()}>
              Add
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {templates?.map((t) => (
        <div key={t._id} className="settings-row template-row">
          {editingId === t._id ? (
            <div className="template-form">
              <div className="template-form-row">
                <input
                  placeholder="Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  autoComplete="off"
                />
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                >
                  <option value="">No category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <textarea
                className="template-textarea"
                placeholder="Description template"
                value={editForm.descriptionTemplate}
                onChange={(e) => setEditForm({ ...editForm, descriptionTemplate: e.target.value })}
                rows={4}
              />
              <div className="template-form-row">
                <input
                  placeholder="Default tags (comma separated)"
                  value={editForm.defaultTags}
                  onChange={(e) => setEditForm({ ...editForm, defaultTags: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="template-form-row">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    await updateTemplate({
                      id: t._id,
                      name: editForm.name,
                      descriptionTemplate: editForm.descriptionTemplate,
                      defaultTags: editForm.defaultTags
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      category: editForm.category || undefined,
                    });
                    setEditingId(null);
                  }}
                >
                  Save
                </button>
                <button className="btn btn-sm" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="template-row-display">
              <span>{t.name}</span>
              {t.category && (
                <span className="template-category-badge">
                  {t.category}
                </span>
              )}
              {t.defaultTags.length > 0 && (
                <span className="meta-value">{t.defaultTags.join(", ")}</span>
              )}
              <button
                className="btn btn-sm template-edit-btn"
                onClick={() => {
                  setEditingId(t._id);
                  setEditForm({
                    name: t.name,
                    descriptionTemplate: t.descriptionTemplate,
                    defaultTags: t.defaultTags.join(", "),
                    category: t.category ?? "",
                  });
                }}
              >
                Edit
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  if (window.confirm(`Delete template "${t.name}"?`)) {
                    void removeTemplate({ id: t._id });
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
