import { useState, useRef, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Input } from "@/ui/components/ui/input";
import { cn } from "@/ui/lib/utils";

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
    <div className="mb-4 border-b border-border pb-4">
      <h3 className="mb-2 text-base font-semibold">
        Checklist
        {checklist.length > 0 && (
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {completedCount}/{checklist.length}
          </span>
        )}
      </h3>

      {checklist.length > 0 && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width]",
              completedCount === checklist.length && "bg-emerald-600",
            )}
            style={{ width: `${(completedCount / checklist.length) * 100}%` }}
          />
        </div>
      )}

      <div className="space-y-1">
        {checklist.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm",
              dragId === item.id && "opacity-50",
            )}
            draggable
            onDragStart={() => handleDragStart(item.id)}
            onDragOver={(e) => handleDragOver(e, item.id)}
            onDrop={handleDrop}
            onDragEnd={() => setDragId(null)}
          >
            <span className="cursor-grab text-muted-foreground select-none" title="Drag to reorder">
              &#8942;
            </span>
            <input
              type="checkbox"
              className="size-4 shrink-0 rounded border-input"
              checked={item.completed}
              onChange={() => toggleItem({ issueId, itemId: item.id })}
            />
            {editingId === item.id ? (
              <Input
                className="h-8 flex-1"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                autoFocus
              />
            ) : (
              <span
                className={cn(
                  "min-w-0 flex-1 cursor-text",
                  item.completed && "text-muted-foreground line-through",
                )}
                onClick={() => handleStartEdit(item)}
              >
                {item.text}
              </span>
            )}
            <button
              type="button"
              className="shrink-0 rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => removeItem({ issueId, itemId: item.id })}
              title="Remove item"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <Input
        className="mt-2"
        placeholder="Add item..."
        value={newItemText}
        onChange={(e) => setNewItemText(e.target.value)}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleAdd();
        }}
      />
    </div>
  );
}
