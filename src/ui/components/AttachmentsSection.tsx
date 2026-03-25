import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useRef, useCallback } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
import { ImageLightbox } from "./ImageLightbox";
import { Button, buttonVariants } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/utils";

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function AttachmentPreview({ url, mimeType, filename, onClick }: { url?: string | null; mimeType: string; filename: string; onClick?: () => void }) {
  if (url && isImageMimeType(mimeType)) {
    return (
      <img
        src={url}
        alt={filename}
        className="size-10 shrink-0 rounded object-cover"
        onClick={onClick}
        style={onClick ? { cursor: "pointer" } : undefined}
      />
    );
  }
  return <span className="flex size-10 shrink-0 items-center justify-center text-lg">{getFileIcon(mimeType)}</span>;
}

export function AttachmentsSection({ issueId }: { issueId: Id<"issues"> }) {
  const attachments = useQuery(api.attachments.list, { issueId });
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl);
  const createAttachment = useMutation(api.attachments.create);
  const removeAttachment = useMutation(api.attachments.remove);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<Id<"attachments"> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; filename: string } | null>(null);
  const dragCounterRef = useRef(0);

  const uploadFile = useCallback(async (file: File) => {
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
  }, [generateUploadUrl, createAttachment, issueId]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const results = await Promise.allSettled(files.map((f) => uploadFile(f)));
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        setUploadError(
          `${failed.length} of ${files.length} file(s) failed to upload.`,
        );
      }
    } finally {
      setUploading(false);
    }
  }, [uploadFile]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) {
      void uploadFiles(files);
    }
  }, [uploadFiles]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      void uploadFiles(Array.from(e.dataTransfer.files));
    }
  }, [uploadFiles]);

  const handleDelete = async (id: Id<"attachments">) => {
    setDeletingId(id);
    try {
      await removeAttachment({ id });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className="mb-4"
      onPaste={handlePaste}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <h3 className="mb-2 text-base font-semibold">Attachments</h3>
      {uploadError && (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {uploadError}
        </div>
      )}
      {attachments?.map((a) => (
        <div key={a._id} className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
          <AttachmentPreview
            url={a.url}
            mimeType={a.mimeType}
            filename={a.filename}
            onClick={
              a.url && isImageMimeType(a.mimeType)
                ? () => {
                    const url = a.url;
                    if (url) setLightboxImage({ url, filename: a.filename });
                  }
                : undefined
            }
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" title={a.filename}>
              {a.filename}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">{formatFileSize(a.size)}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {a.url && (
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                download={a.filename}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Download
              </a>
            )}
            <Button variant="destructive" size="sm" onClick={() => handleDelete(a._id)} disabled={deletingId === a._id}>
              {deletingId === a._id ? "..." : "Delete"}
            </Button>
          </div>
        </div>
      ))}
      <div
        className={cn(
          "cursor-pointer rounded-md border-2 border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground transition-colors",
          dragging && "border-primary bg-primary/5 text-foreground",
        )}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: "none" }}
          disabled={uploading}
        />
        {uploading
          ? "Uploading..."
          : dragging
            ? "Drop files here"
            : "Drop files, paste (\u2318V), or click to attach"}
      </div>
      {lightboxImage && (
        <ImageLightbox url={lightboxImage.url} filename={lightboxImage.filename} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  );
}
