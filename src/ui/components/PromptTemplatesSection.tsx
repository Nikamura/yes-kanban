import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { Input } from "@/ui/components/ui/input";
import { Textarea } from "@/ui/components/ui/textarea";

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
      <div
        key={t._id}
        className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/30 p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px] capitalize">
            {typeInfo?.label ?? t.type}
          </Badge>
          {isInherited && (
            <Badge variant="outline" className="text-[10px] opacity-80">
              Global
            </Badge>
          )}
          {t.isDefault && (
            <Badge className="border-transparent bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
              Active
            </Badge>
          )}
          {!isEditing && (
            <>
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-muted-foreground">{typeInfo?.description}</span>
              <div className="ml-auto flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => setExpandedId(isExpanded ? null : t._id)}>
                  {isExpanded ? "Collapse" : "Preview"}
                </Button>
                {!isInherited && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                      Edit
                    </Button>
                    {!t.isDefault && (
                      <Button size="sm" variant="outline" onClick={() => updateTemplate({ id: t._id, isDefault: true })}>
                        Set Active
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm(`Delete template "${t.name}"?`)) {
                          void removeTemplate({ id: t._id });
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        {isEditing && (
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Template name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              autoComplete="off"
            />
            <Textarea
              value={editForm.content}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
              rows={12}
              className="font-mono text-sm"
            />
            <p className="m-0 text-xs text-muted-foreground">
              Placeholders: {"{{issueId}}"}, {"{{title}}"}, {"{{baseBranch}}"}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {isExpanded && !isEditing && (
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-[0.8rem]">
            {t.content}
          </pre>
        )}
      </div>
    );
  };

  return (
    <section className="mb-8 max-w-[800px] space-y-3" data-testid="prompt-templates-section">
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        Prompt Templates
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!showAdd) {
              setAddForm({ name: "", type: "workflow", content: DEFAULT_TEMPLATES["workflow"] ?? "", scope: "project" });
            }
            setShowAdd(!showAdd);
          }}
        >
          + Add
        </Button>
      </h2>
      <p className="text-sm text-muted-foreground">
        Customize the prompts sent to agents. Project templates override global ones.
      </p>

      {showAdd && (
        <form className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" onSubmit={handleCreate}>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Template name"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              className="min-w-[150px] flex-1"
              autoComplete="off"
            />
            <select
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
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
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={addForm.scope}
              onChange={(e) => setAddForm({ ...addForm, scope: e.target.value as "project" | "global" })}
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
          </div>
          <Textarea
            placeholder="Template content (markdown)..."
            value={addForm.content}
            onChange={(e) => setAddForm({ ...addForm, content: e.target.value })}
            rows={10}
            className="font-mono text-sm"
          />
          <p className="m-0 text-xs text-muted-foreground">
            Placeholders: {"{{issueId}}"}, {"{{title}}"}, {"{{baseBranch}}"}
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!addForm.name.trim() || !addForm.content.trim()}>
              Create
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {projectTemplates.length === 0 && inheritedGlobal.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No custom templates. Using built-in defaults.
          </div>
        )}
        {projectTemplates.map((t) => renderTemplate(t))}
        {inheritedGlobal.map((t) => renderTemplate(t, true))}
      </div>
    </section>
  );
}
