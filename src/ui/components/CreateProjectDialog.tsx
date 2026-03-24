import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new project with a display name and an issue ID prefix for this
            workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="create-project-name">Name</Label>
            <Input
              id="create-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-project-prefix">ID Prefix</Label>
            <Input
              id="create-project-prefix"
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder={slug.toUpperCase().slice(0, 4) || "TASK"}
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">
              Used for issue IDs like {prefix || "TASK"}-1
            </p>
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
