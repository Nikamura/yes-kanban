import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { useEscapeClose } from "../hooks/useEscapeClose";

export function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: Id<"projects">) => void;
}) {
  const createProject = useMutation(api.projects.create);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [error, setError] = useState("");
  useEscapeClose(onClose);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const id = await createProject({
        name: name.trim(),
        slug: slug || "project",
        simpleIdPrefix: prefix.toUpperCase() || slug.toUpperCase().slice(0, 4) || "TASK",
      });
      onCreated(id);
    } catch (err: any) {
      setError(err.message ?? "Failed to create project");
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Create Project</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="form-field">
            <label>ID Prefix</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder={slug.toUpperCase().slice(0, 4) || "TASK"}
              autoComplete="off"
            />
            <small>Used for issue IDs like {prefix || "TASK"}-1</small>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
