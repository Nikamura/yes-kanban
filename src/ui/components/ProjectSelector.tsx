import type { Doc, Id } from "../../../convex/_generated/dataModel";

export function ProjectSelector({
  projects,
  selectedId,
  onSelect,
  onCreateNew,
}: {
  projects: Doc<"projects">[];
  selectedId: Id<"projects"> | null;
  onSelect: (id: Id<"projects">) => void;
  onCreateNew: () => void;
}) {
  return (
    <nav className="project-sidebar" aria-label="Projects">
      {projects.map((p) => {
        const isSelected = p._id === selectedId;
        return (
          <button
            key={p._id}
            className={`project-sidebar-item ${isSelected ? "active" : ""}`}
            onClick={() => onSelect(p._id)}
            title={p.name}
            aria-current={isSelected ? "true" : undefined}
          >
            <span className="project-sidebar-icon">{p.simpleIdPrefix}</span>
            {isSelected && <span className="project-sidebar-indicator" />}
          </button>
        );
      })}
      <button
        className="project-sidebar-item project-sidebar-add"
        onClick={onCreateNew}
        title="New Project"
      >
        <span className="project-sidebar-icon" aria-hidden="true">+</span>
      </button>
    </nav>
  );
}
