import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

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
    <div className={`bulk-action-bar ${count > 0 ? "visible" : ""}`}>
      <span className="bulk-count">{count} selected</span>

      <div className="bulk-actions">
        {/* Move to column */}
        <div className="bulk-dropdown">
          <button
            className="bulk-btn"
            onClick={() => {
              const wasOpen = showMoveMenu;
              closeAllMenus();
              if (!wasOpen) setShowMoveMenu(true);
            }}
          >
            Move to...
          </button>
          {showMoveMenu && columns && (
            <div className="bulk-dropdown-menu">
              {columns
                .filter((c) => c.visible)
                .map((col) => (
                  <button
                    key={col._id}
                    className="bulk-dropdown-item"
                    onClick={() => handleMove(col.name)}
                  >
                    {col.name}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Add tags */}
        <div className="bulk-dropdown">
          <button
            className="bulk-btn"
            onClick={() => {
              const wasOpen = showAddTagMenu;
              closeAllMenus();
              if (!wasOpen) setShowAddTagMenu(true);
            }}
          >
            Add Tag...
          </button>
          {showAddTagMenu && (
            <div className="bulk-dropdown-menu">
              <div className="bulk-tag-input-row">
                <input
                  className="bulk-tag-input"
                  placeholder="Tag name..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddTag();
                  }}
                  autoFocus
                />
                <button className="bulk-dropdown-item" onClick={handleAddTag}>
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Remove tags */}
        <div className="bulk-dropdown">
          <button
            className="bulk-btn"
            onClick={() => {
              const wasOpen = showRemoveTagMenu;
              closeAllMenus();
              if (!wasOpen) setShowRemoveTagMenu(true);
            }}
          >
            Remove Tag...
          </button>
          {showRemoveTagMenu && (
            <div className="bulk-dropdown-menu">
              <div className="bulk-tag-input-row">
                <input
                  className="bulk-tag-input"
                  placeholder="Tag name..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRemoveTag();
                  }}
                  autoFocus
                />
                <button className="bulk-dropdown-item" onClick={handleRemoveTag}>
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Archive */}
        <button
          className="bulk-btn"
          onClick={async () => {
            await bulkArchive({ ids });
            onClearSelection();
          }}
        >
          Archive
        </button>

        {/* Delete */}
        {!confirmDelete ? (
          <button
            className="bulk-btn bulk-btn-danger"
            onClick={() => {
              closeAllMenus();
              setConfirmDelete(true);
            }}
          >
            Delete
          </button>
        ) : (
          <button className="bulk-btn bulk-btn-danger" onClick={handleDelete}>
            Confirm delete {count}?
          </button>
        )}
      </div>

      <button className="bulk-deselect" onClick={onClearSelection} title="Clear selection">
        ✕
      </button>
    </div>
  );
}
