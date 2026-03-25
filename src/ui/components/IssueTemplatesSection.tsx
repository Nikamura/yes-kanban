import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { Input } from "@/ui/components/ui/input";
import { Textarea } from "@/ui/components/ui/textarea";
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
    <section className="mb-8 max-w-[800px] space-y-3">
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        Issue Templates
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
          + Add
        </Button>
      </h2>
      <p className="text-sm text-muted-foreground">
        Templates pre-fill issue fields when creating new issues.
      </p>

      {showAdd && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
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
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Template name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoComplete="off"
              className="min-w-[150px] flex-1"
            />
            <select
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">No category</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <Textarea
            placeholder="Description template (Markdown)"
            value={form.descriptionTemplate}
            onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })}
            rows={4}
            className="font-mono text-sm"
          />
          <Input
            placeholder="Default tags (comma separated)"
            value={form.defaultTags}
            onChange={(e) => setForm({ ...form, defaultTags: e.target.value })}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!form.name.trim()}>
              Add
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {templates?.map((t) => (
        <div key={t._id} className="rounded-lg border border-border bg-secondary/30 p-3">
          {editingId === t._id ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  autoComplete="off"
                />
                <select
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                >
                  <option value="">No category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <Textarea
                placeholder="Description template"
                value={editForm.descriptionTemplate}
                onChange={(e) => setEditForm({ ...editForm, descriptionTemplate: e.target.value })}
                rows={4}
                className="font-mono text-sm"
              />
              <Input
                placeholder="Default tags (comma separated)"
                value={editForm.defaultTags}
                onChange={(e) => setEditForm({ ...editForm, defaultTags: e.target.value })}
                autoComplete="off"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
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
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.name}</span>
              {t.category && (
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {t.category}
                </Badge>
              )}
              {t.defaultTags.length > 0 && (
                <span className="font-mono text-xs text-muted-foreground">{t.defaultTags.join(", ")}</span>
              )}
              <div className="ml-auto flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
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
                </Button>
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
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
