import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useRef, useCallback } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
import { useEscapeClose } from "../hooks/useEscapeClose";

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function AttachmentPreview({ url, mimeType, filename, onClick }: { url?: string | null; mimeType: string; filename: string; onClick?: () => void }) {
  if (url && isImageMimeType(mimeType)) {
    return <img src={url} alt={filename} className="attachment-preview-thumb" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined} />;
  }
  return <span className="attachment-preview-icon">{getFileIcon(mimeType)}</span>;
}

function ImageLightbox({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  useEscapeClose(onClose);
  return (
    <div className="dialog-overlay" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="image-lightbox-close" onClick={onClose}>&times;</button>
        <img src={url} alt={filename} className="image-lightbox-img" />
        <div className="image-lightbox-caption">{filename}</div>
      </div>
    </div>
  );
}

export function AttachmentsSection({ issueId }: { issueId: Id<"issues"> }) {
  const attachments = useQuery(api.attachments.list, { issueId });
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl);
  const createAttachment = useMutation(api.attachments.create);
  const removeAttachment = useMutation(api.attachments.remove);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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
    try {
      await Promise.allSettled(files.map((f) => uploadFile(f)));
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
      className="attachments-section"
      onPaste={handlePaste}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <h3>Attachments</h3>
      {attachments?.map((a) => (
        <div key={a._id} className="attachment-row attachment-row-with-preview">
          <AttachmentPreview url={a.url} mimeType={a.mimeType} filename={a.filename} onClick={a.url && isImageMimeType(a.mimeType) ? () => setLightboxImage({ url: a.url!, filename: a.filename }) : undefined} />
          <div className="attachment-info">
            <span className="attachment-name" title={a.filename}>
              {a.filename}
            </span>
            <span className="attachment-size">{formatFileSize(a.size)}</span>
          </div>
          <div className="attachment-actions">
            {a.url && (
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm"
                download={a.filename}
              >
                Download
              </a>
            )}
            <button
              className="btn btn-sm btn-danger"
              onClick={() => handleDelete(a._id)}
              disabled={deletingId === a._id}
            >
              {deletingId === a._id ? "..." : "Delete"}
            </button>
          </div>
        </div>
      ))}
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
