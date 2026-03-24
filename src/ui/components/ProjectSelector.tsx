import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/ui/lib/utils";

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
    <nav
      className="-order-1 flex shrink-0 flex-row items-center gap-1.5 overflow-x-auto overflow-y-hidden border-b border-border bg-background px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:order-none lg:w-14 lg:flex-col lg:gap-1 lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-1.5 lg:py-2.5"
      aria-label="Projects"
    >
      {projects.map((p) => {
        const isSelected = p._id === selectedId;
        return (
          <button
            key={p._id}
            type="button"
            className={cn(
              "relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 font-mono text-[10px] font-bold tracking-wide text-muted-foreground uppercase transition-all duration-200",
              "hover:rounded-lg hover:bg-primary/10 hover:text-foreground",
              isSelected &&
                "rounded-lg bg-primary text-primary-foreground shadow-[0_0_20px_rgba(37,99,235,0.15)] hover:bg-primary hover:text-primary-foreground",
            )}
            onClick={() => onSelect(p._id)}
            title={p.name}
            aria-current={isSelected ? "true" : undefined}
          >
            <span>{p.simpleIdPrefix}</span>
            {isSelected && (
              <span
                className="absolute -bottom-1.5 left-1/2 h-1 w-5 -translate-x-1/2 rounded-t bg-primary lg:top-1/2 lg:left-[-9px] lg:h-5 lg:w-1 lg:-translate-y-1/2 lg:translate-x-0 lg:rounded-none lg:rounded-r"
                aria-hidden
              />
            )}
          </button>
        );
      })}
      <button
        type="button"
        data-testid="project-sidebar-add"
        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border bg-transparent font-light text-xl text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
        onClick={onCreateNew}
        title="New Project"
      >
        <span aria-hidden="true">+</span>
      </button>
    </nav>
  );
}
