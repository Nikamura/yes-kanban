import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
interface PendingFile {
  file: File;
  id: string;
  previewUrl?: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function FilePreview({ file, previewUrl }: { file: File; previewUrl?: string }) {
  if (previewUrl && isImageFile(file)) {
    return <img src={previewUrl} alt={file.name} className="attachment-preview-thumb" />;
  }
  return <span className="attachment-preview-icon">{getFileIcon(file.type)}</span>;
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
  const [autoMerge, setAutoMerge] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEscapeClose(onClose);
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
        autoMerge: autoMerge || undefined,
      });
      if (pendingFiles.length > 0) {
        await Promise.allSettled(pendingFiles.map((pf) => uploadFile(pf.file, issueId)));
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className={`dialog${dragging ? " dialog-drag-active" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        <h2>Create Issue</h2>
        <form onSubmit={handleSubmit}>
          {templates && templates.length > 0 && (
            <div className="form-field">
              <label>Template</label>
              <select
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
          <div className="form-field">
            <label>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="form-field">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description (Markdown)"
              rows={4}
            />
          </div>
          <div className="form-field">
            <label>Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tag1, tag2"
              autoComplete="off"
            />
          </div>
          <div className="form-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={deepResearch}
                onChange={(e) => setDeepResearch(e.target.checked)}
              />
              Deep research (web search during planning)
            </label>
          </div>
          <div className="form-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoMerge}
                onChange={(e) => setAutoMerge(e.target.checked)}
              />
              Auto-merge after review
            </label>
          </div>
          <div className="form-field">
            <label>Attachments</label>
            <div
              className={`drop-zone${dragging ? " drop-zone-active" : ""}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
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
              <div className="pending-files">
                {pendingFiles.map((pf) => (
                  <div key={pf.id} className="attachment-row attachment-row-with-preview">
                    <FilePreview file={pf.file} previewUrl={pf.previewUrl} />
                    <div className="attachment-info">
                      <span className="attachment-name" title={pf.file.name}>
                        {pf.file.name}
                      </span>
                      <span className="attachment-size">
                        {formatFileSize(pf.file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => removeFile(pf.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
