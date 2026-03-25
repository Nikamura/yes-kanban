import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { cn } from "@/ui/lib/utils";

export function BulkActionBar({
  projectId,
  selectedIds,
  onClearSelection,
}: {
  projectId: Id<"projects">;
  selectedIds: Set<Id<"issues">>;
  onClearSelection: () => void;
}) {
  const columns = useQuery(api.columns.list, { projectId });
  const bulkMove = useMutation(api.bulkIssues.bulkMove);
  const bulkAddTags = useMutation(api.bulkIssues.bulkAddTags);
  const bulkRemoveTags = useMutation(api.bulkIssues.bulkRemoveTags);
  const bulkDelete = useMutation(api.bulkIssues.bulkDelete);
  const bulkArchive = useMutation(api.bulkIssues.bulkArchive);

  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showAddTagMenu, setShowAddTagMenu] = useState(false);
  const [showRemoveTagMenu, setShowRemoveTagMenu] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const count = selectedIds.size;
  const ids = [...selectedIds] as Id<"issues">[];

  const handleMove = async (status: string) => {
    await bulkMove({ ids, status });
    setShowMoveMenu(false);
    onClearSelection();
  };

  const closeAllMenus = () => {
    setShowMoveMenu(false);
    setShowAddTagMenu(false);
    setShowRemoveTagMenu(false);
    setConfirmDelete(false);
    setTagInput("");
  };

  const handleAddTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    await bulkAddTags({ ids, tags: [tag] });
    setTagInput("");
    setShowAddTagMenu(false);
    onClearSelection();
  };

  const handleRemoveTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    await bulkRemoveTags({ ids, tags: [tag] });
    setTagInput("");
    setShowRemoveTagMenu(false);
    onClearSelection();
  };

  const handleDelete = async () => {
    await bulkDelete({ ids });
    setConfirmDelete(false);
    onClearSelection();
  };

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[85] flex max-w-[min(96vw,720px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2 py-2 shadow-xl transition-opacity md:px-4",
        count === 0 && "pointer-events-none opacity-0",
      )}
    >
      <span className="shrink-0 font-mono text-xs font-medium">{count} selected</span>

      <div className="flex flex-1 flex-wrap items-center gap-1">
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              const wasOpen = showMoveMenu;
              closeAllMenus();
              if (!wasOpen) setShowMoveMenu(true);
            }}
          >
            Move to...
          </Button>
          {showMoveMenu && columns && (
            <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md">
              {columns
                .filter((c) => c.visible)
                .map((col) => (
                  <button
                    key={col._id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => handleMove(col.name)}
                  >
                    {col.name}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              const wasOpen = showAddTagMenu;
              closeAllMenus();
              if (!wasOpen) setShowAddTagMenu(true);
            }}
          >
            Add Tag...
          </Button>
          {showAddTagMenu && (
            <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[12rem] rounded-md border border-border bg-popover p-2 shadow-md">
              <div className="flex gap-1">
                <Input
                  placeholder="Tag name..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAddTag();
                  }}
                  autoFocus
                  className="h-8 text-sm"
                />
                <Button type="button" size="sm" className="h-8 shrink-0" onClick={handleAddTag}>
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              const wasOpen = showRemoveTagMenu;
              closeAllMenus();
              if (!wasOpen) setShowRemoveTagMenu(true);
            }}
          >
            Remove Tag...
          </Button>
          {showRemoveTagMenu && (
            <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[12rem] rounded-md border border-border bg-popover p-2 shadow-md">
              <div className="flex gap-1">
                <Input
                  placeholder="Tag name..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRemoveTag();
                  }}
                  autoFocus
                  className="h-8 text-sm"
                />
                <Button type="button" size="sm" className="h-8 shrink-0" onClick={handleRemoveTag}>
                  Remove
                </Button>
              </div>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={async () => {
            await bulkArchive({ ids });
            onClearSelection();
          }}
        >
          Archive
        </Button>

        {!confirmDelete ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-9"
            onClick={() => {
              closeAllMenus();
              setConfirmDelete(true);
            }}
          >
            Delete
          </Button>
        ) : (
          <Button type="button" variant="destructive" size="sm" className="h-9" onClick={handleDelete}>
            Confirm delete {count}?
          </Button>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onClearSelection}
        title="Clear selection"
      >
        ✕
      </Button>
    </div>
  );
}
