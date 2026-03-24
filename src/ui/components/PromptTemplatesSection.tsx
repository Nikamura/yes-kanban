import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id, Doc } from "../../../convex/_generated/dataModel";

const TEMPLATE_TYPES = [
  { value: "workflow", label: "Workflow", description: "Instructions for the coding agent" },
  { value: "review", label: "Review", description: "Criteria for the review agent" },
  { value: "rebase", label: "Rebase", description: "Instructions for conflict resolution" },
  { value: "planning", label: "Planning", description: "Instructions for the planning phase" },
  { value: "plan_review", label: "Plan Review", description: "Criteria for reviewing plans" },
  { value: "grilling", label: "Grill Me", description: "Extra instructions for the pre-planning interview" },
] as const;

const DEFAULT_TEMPLATES: Record<string, string> = {
  workflow: `1. Implement the changes described above.
2. Self-review your changes before finishing.
3. Run tests if available and fix any failures.
4. Commit your changes with meaningful commit messages referencing {{issueId}}.
5. Do not exit until you believe the work is complete and tests pass.`,
  review: `Check for:
- Bugs and logic errors
- Missing edge cases
- Code style issues
- Security concerns
- Missing or inadequate tests
- Documentation gaps

Respond with one of:
- APPROVE - if changes look good
- REQUEST_CHANGES - followed by specific changes needed
- CONCERN - followed by potential problems (informational, non-blocking)`,
  rebase: `Resolve conflicts for branch rebased onto {{baseBranch}}.

1. Open each conflicted file and resolve the conflict markers.
2. After resolving a file, run \`git add <file>\` to mark it resolved.
3. Once all conflicts are resolved, run \`git rebase --continue\`.
4. If \`rebase --continue\` produces new conflicts, repeat steps 1-3.
5. Continue until the rebase is fully complete.

**IMPORTANT:** Do NOT run \`git rebase --abort\`. You must resolve the conflicts.`,
  grilling: `Optional extra focus areas for the grill interview (issue {{issueId}}).
`,
};

type TemplateDoc = Doc<"promptTemplates">;

export function PromptTemplatesSection({ projectId }: { projectId: Id<"projects"> }) {
  const templates = useQuery(api.promptTemplates.list, { projectId });
  const globalTemplates = useQuery(api.promptTemplates.list, {});
  const createTemplate = useMutation(api.promptTemplates.create);
  const updateTemplate = useMutation(api.promptTemplates.update);
  const removeTemplate = useMutation(api.promptTemplates.remove);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    type: "workflow" as "workflow" | "review" | "rebase" | "planning" | "plan_review" | "grilling",
    content: "",
    scope: "project" as "project" | "global",
  });
  const [editingId, setEditingId] = useState<Id<"promptTemplates"> | null>(null);
  const [editForm, setEditForm] = useState({ name: "", content: "" });
  const [expandedId, setExpandedId] = useState<Id<"promptTemplates"> | null>(null);

  if (templates === undefined || globalTemplates === undefined) {
    return null;
  }

  // Separate project-level and global templates
  const projectTemplates = templates.filter((t) => t.projectId === projectId);
  const inheritedGlobal = globalTemplates.filter(
    (t) => !t.projectId && !projectTemplates.some((pt) => pt.type === t.type && pt.isDefault)
  );

  const handleCreate = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    await createTemplate({
      projectId: addForm.scope === "project" ? projectId : undefined,
      name: addForm.name,
      type: addForm.type,
      content: addForm.content,
      isDefault: true,
    });
    setAddForm({ name: "", type: "workflow", content: DEFAULT_TEMPLATES["workflow"] ?? "", scope: "project" });
    setShowAdd(false);
  };

  const handleSave = async () => {
    if (!editingId) return;
    await updateTemplate({
      id: editingId,
      name: editForm.name,
      content: editForm.content,
    });
    setEditingId(null);
  };

  const startEdit = (t: TemplateDoc) => {
    setEditingId(t._id);
    setEditForm({ name: t.name, content: t.content });
  };

  const renderTemplate = (t: TemplateDoc, isInherited = false) => {
    const isEditing = editingId === t._id;
    const isExpanded = expandedId === t._id;
    const typeInfo = TEMPLATE_TYPES.find((tt) => tt.value === t.type);

    return (
      <div key={t._id} className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="badge" style={{ textTransform: "capitalize" }}>{typeInfo?.label ?? t.type}</span>
          {isInherited && <span className="badge" style={{ opacity: 0.6 }}>Global</span>}
          {t.isDefault && <span className="badge" style={{ background: "#10b981", color: "#fff" }}>Active</span>}
          {!isEditing && (
            <>
              <span style={{ fontWeight: 500 }}>{t.name}</span>
              <span className="meta-value" style={{ fontSize: "0.75rem" }}>
                {typeInfo?.description}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: "0.25rem" }}>
                <button
                  className="btn btn-sm"
                  onClick={() => setExpandedId(isExpanded ? null : t._id)}
                >
                  {isExpanded ? "Collapse" : "Preview"}
                </button>
                {!isInherited && (
                  <>
                    <button className="btn btn-sm" onClick={() => startEdit(t)}>Edit</button>
                    {!t.isDefault && (
                      <button
                        className="btn btn-sm"
                        onClick={() => updateTemplate({ id: t._id, isDefault: true })}
                      >
                        Set Active
                      </button>
                    )}
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
                  </>
                )}
              </div>
            </>
          )}
        </div>
        {isEditing && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input
              placeholder="Template name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              autoComplete="off"
            />
            <textarea
              className="import-textarea"
              value={editForm.content}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
              rows={12}
              style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
            />
            <p className="meta-value" style={{ fontSize: "0.75rem", margin: 0 }}>
              Placeholders: {"{{issueId}}"}, {"{{title}}"}, {"{{baseBranch}}"}
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
              <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          </div>
        )}
        {isExpanded && !isEditing && (
          <pre
            className="max-h-[300px] overflow-auto rounded-md bg-secondary p-3 text-[0.8rem] whitespace-pre-wrap break-words"
            style={{ margin: 0 }}
          >
            {t.content}
          </pre>
        )}
      </div>
    );
  };

  return (
    <section className="settings-section">
      <h2>
        Prompt Templates
        <button className="btn btn-sm" onClick={() => {
          if (!showAdd) {
            setAddForm({ name: "", type: "workflow", content: DEFAULT_TEMPLATES["workflow"] ?? "", scope: "project" });
          }
          setShowAdd(!showAdd);
        }}>+ Add</button>
      </h2>
      <p className="meta-value" style={{ margin: "0 0 0.75rem", fontSize: "0.8rem" }}>
        Customize the prompts sent to agents. Project templates override global ones.
      </p>

      {showAdd && (
        <form className="inline-form" onSubmit={handleCreate} style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              placeholder="Template name"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              style={{ flex: 1, minWidth: "150px" }}
              autoComplete="off"
            />
            <select
              value={addForm.type}
              onChange={(e) => {
                const type = e.target.value as "workflow" | "review" | "rebase" | "planning" | "plan_review" | "grilling";
                setAddForm({
                  ...addForm,
                  type,
                  content: addForm.content ? addForm.content : (DEFAULT_TEMPLATES[type] ?? ""),
                });
              }}
            >
              {TEMPLATE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <select
              value={addForm.scope}
              onChange={(e) => setAddForm({ ...addForm, scope: e.target.value as "project" | "global" })}
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
          </div>
          <textarea
            className="import-textarea"
            placeholder="Template content (markdown)..."
            value={addForm.content}
            onChange={(e) => setAddForm({ ...addForm, content: e.target.value })}
            rows={10}
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
          />
          <p className="meta-value" style={{ fontSize: "0.75rem", margin: 0 }}>
            Placeholders: {"{{issueId}}"}, {"{{title}}"}, {"{{baseBranch}}"}
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!addForm.name.trim() || !addForm.content.trim()}
            >
              Create
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="settings-table">
        {projectTemplates.length === 0 && inheritedGlobal.length === 0 && (
          <div className="settings-row">
            <span className="meta-value">No custom templates. Using built-in defaults.</span>
          </div>
        )}
        {projectTemplates.map((t) => renderTemplate(t))}
        {inheritedGlobal.map((t) => renderTemplate(t, true))}
      </div>
    </section>
  );
}
