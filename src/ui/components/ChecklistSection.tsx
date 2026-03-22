import { useState, useRef, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export function ChecklistSection({
  issueId,
  checklist,
}: {
  issueId: Id<"issues">;
  checklist: ChecklistItem[];
}) {
  const addItem = useMutation(api.checklists.addItem);
  const removeItem = useMutation(api.checklists.removeItem);
  const toggleItem = useMutation(api.checklists.toggleItem);
  const updateItemText = useMutation(api.checklists.updateItemText);
  const reorderChecklist = useMutation(api.checklists.reorder);

  const [newItemText, setNewItemText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  const dragOverId = useRef<string | null>(null);

  const completedCount = checklist.filter((i) => i.completed).length;

  const handleAdd = useCallback(async () => {
    const trimmed = newItemText.trim();
    if (!trimmed) return;
    const text = newItemText;
    setNewItemText("");
    try {
      await addItem({ issueId, text: trimmed });
    } catch {
      setNewItemText(text);
    }
  }, [newItemText, issueId, addItem]);

  const handleStartEdit = (item: ChecklistItem) => {
    setEditingId(item.id);
    setEditText(item.text);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const trimmed = editText.trim();
    if (trimmed && trimmed !== checklist.find((i) => i.id === editingId)?.text) {
      await updateItemText({ issueId, itemId: editingId, text: trimmed });
    }
    setEditingId(null);
  };

  const handleDragStart = (itemId: string) => {
    setDragId(itemId);
  };

  const handleDragOver = (e: React.DragEvent, itemId: string) => {
    e.preventDefault();
    dragOverId.current = itemId;
  };

  const handleDrop = async () => {
    if (!dragId || !dragOverId.current || dragId === dragOverId.current) {
      setDragId(null);
      return;
    }
    const ids = checklist.map((i) => i.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(dragOverId.current);
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null);
      return;
    }
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    setDragId(null);
    await reorderChecklist({ issueId, itemIds: ids });
  };

  return (
    <div className="checklist-section">
      <h3>
        Checklist
        {checklist.length > 0 && (
          <span className="checklist-progress-label">
            {completedCount}/{checklist.length}
          </span>
        )}
      </h3>

      {checklist.length > 0 && (
        <div className="checklist-progress-bar-container">
          <div
            className={`checklist-progress-bar ${completedCount === checklist.length ? "complete" : ""}`}
            style={{ width: `${(completedCount / checklist.length) * 100}%` }}
          />
        </div>
      )}

      <div className="checklist-items">
        {checklist.map((item) => (
          <div
            key={item.id}
            className={`checklist-item ${dragId === item.id ? "dragging" : ""}`}
            draggable
            onDragStart={() => handleDragStart(item.id)}
            onDragOver={(e) => handleDragOver(e, item.id)}
            onDrop={handleDrop}
            onDragEnd={() => setDragId(null)}
          >
            <span className="checklist-drag-handle" title="Drag to reorder">&#8942;</span>
            <input
              type="checkbox"
              className="checklist-checkbox"
              checked={item.completed}
              onChange={() => toggleItem({ issueId, itemId: item.id })}
            />
            {editingId === item.id ? (
              <input
                className="checklist-edit-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                autoFocus
              />
            ) : (
              <span
                className={`checklist-item-text ${item.completed ? "completed" : ""}`}
                onClick={() => handleStartEdit(item)}
              >
                {item.text}
              </span>
            )}
            <button
              type="button"
              className="checklist-item-remove"
              onClick={() => removeItem({ issueId, itemId: item.id })}
              title="Remove item"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <input
        className="checklist-add-input"
        placeholder="Add item..."
        value={newItemText}
        onChange={(e) => setNewItemText(e.target.value)}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
        }}
      />
    </div>
  );
}
