import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Textarea } from "@/ui/components/ui/textarea";
import { Label } from "@/ui/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { cn } from "@/ui/lib/utils";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
import { ImageLightbox } from "./ImageLightbox";
interface PendingFile {
  file: File;
  id: string;
  previewUrl?: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function FilePreview({
  file,
  previewUrl,
  onClick,
}: {
  file: File;
  previewUrl?: string;
  onClick?: () => void;
}) {
  if (previewUrl && isImageFile(file)) {
    return (
      <img
        src={previewUrl}
        alt={file.name}
        className="size-10 shrink-0 rounded object-cover"
        onClick={onClick}
        style={onClick ? { cursor: "pointer" } : undefined}
      />
    );
  }
  return <span className="flex size-10 shrink-0 items-center justify-center text-lg">{getFileIcon(file.type)}</span>;
}

export function CreateIssueDialog({
  projectId,
  defaultStatus,
  onClose,
}: {
  projectId: Id<"projects">;
  defaultStatus: string;
  onClose: () => void;
}) {
  const createIssue = useMutation(api.issues.create);
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl);
  const createAttachment = useMutation(api.attachments.create);
  const templates = useQuery(api.issueTemplates.list, { projectId });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);
  const [grillMe, setGrillMe] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    filename: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const applyTemplate = (templateId: string) => {
    const template = templates?.find((t) => t._id === templateId);
    if (!template) return;
    setDescription(template.descriptionTemplate);
    if (template.defaultTags.length > 0) setTags(template.defaultTags.join(", "));
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files).map((file) => ({
      file,
      id: crypto.randomUUID(),
      previewUrl: isImageFile(file) ? URL.createObjectURL(file) : undefined,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      pendingFiles.forEach((pf) => {
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeFile = useCallback((id: string) => {
    setPendingFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length > 0) {
        addFiles(files);
      }
    },
    [addFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles],
  );

  const uploadFile = async (file: File, issueId: Id<"issues">) => {
    const uploadUrl = await generateUploadUrl();
    const result = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!result.ok) {
      throw new Error(`Upload failed (${result.status})`);
    }
    const { storageId } = await result.json();
    await createAttachment({
      issueId,
      storageId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const issueId = await createIssue({
        projectId,
        title: title.trim(),
        description: description.trim(),
        status: defaultStatus,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        deepResearch: deepResearch || undefined,
        grillMe: grillMe || undefined,
        autoMerge: autoMerge || undefined,
      });
      if (pendingFiles.length > 0) {
        const results = await Promise.allSettled(
          pendingFiles.map((pf) => uploadFile(pf.file, issueId)),
        );
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          setSubmitError(
            `${failed.length} attachment(s) failed to upload. The issue was created.`,
          );
          return;
        }
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          showCloseButton
          data-testid="create-issue-dialog"
          className={cn(
            "max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg",
            dragging && "ring-2 ring-primary/50",
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPaste={handlePaste}
        >
          <DialogHeader>
            <DialogTitle>Create Issue</DialogTitle>
            <DialogDescription className="sr-only">
              Add a new issue with title, description, tags, optional flags, and file
              attachments.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4">
            {templates && templates.length > 0 && (
              <div className="space-y-1.5">
                <Label>Template</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  onChange={(e) => {
                    if (e.target.value) applyTemplate(e.target.value);
                  }}
                  defaultValue=""
                >
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}{t.category ? ` (${t.category})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="create-issue-title">Title</Label>
              <Input
                id="create-issue-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-issue-desc">Description</Label>
              <Textarea
                id="create-issue-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed description (Markdown)"
                rows={4}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-issue-tags">Tags</Label>
              <Input
                id="create-issue-tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tag1, tag2"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="create-issue-deep"
                type="checkbox"
                className="size-4 rounded border-input"
                checked={deepResearch}
                onChange={(e) => setDeepResearch(e.target.checked)}
              />
              <Label htmlFor="create-issue-deep" className="cursor-pointer font-normal">
                Deep research (web search during planning)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="create-issue-grill"
                type="checkbox"
                className="size-4 rounded border-input"
                checked={grillMe}
                onChange={(e) => setGrillMe(e.target.checked)}
              />
              <Label htmlFor="create-issue-grill" className="cursor-pointer font-normal">
                Grill me (before planning — interview to stress-test the design)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="create-issue-automerge"
                type="checkbox"
                className="size-4 rounded border-input"
                checked={autoMerge}
                onChange={(e) => setAutoMerge(e.target.checked)}
              />
              <Label htmlFor="create-issue-automerge" className="cursor-pointer font-normal">
                Auto-merge after review
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label>Attachments</Label>
              <div
                data-testid="create-issue-drop-zone"
                className={cn(
                  "cursor-pointer rounded-md border-2 border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground transition-colors",
                  dragging && "border-primary bg-primary/5 text-foreground",
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  data-testid="create-issue-file-input"
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                {dragging
                  ? "Drop files here"
                  : "Drop files, paste (\u2318V), or click to attach"}
              </div>
              {pendingFiles.length > 0 && (
                <div className="space-y-2" data-testid="pending-files">
                  {pendingFiles.map((pf) => (
                    <div key={pf.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
                      <FilePreview
                        file={pf.file}
                        previewUrl={pf.previewUrl}
                        onClick={
                          pf.previewUrl && isImageFile(pf.file)
                            ? () => {
                                const url = pf.previewUrl;
                                if (url) {
                                  setLightboxImage({ url, filename: pf.file.name });
                                }
                              }
                            : undefined
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" title={pf.file.name} data-testid="pending-attachment-name">
                          {pf.file.name}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground" data-testid="pending-attachment-size">
                          {formatFileSize(pf.file.size)}
                        </span>
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => removeFile(pf.id)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {submitError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {submitError}
              </div>
            ) : null}
            <DialogFooter className="gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {lightboxImage ? (
        <ImageLightbox
          url={lightboxImage.url}
          filename={lightboxImage.filename}
          onClose={() => setLightboxImage(null)}
        />
      ) : null}
    </>
  );
}
