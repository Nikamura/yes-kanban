export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("video/")) return "\u25B6";
  if (mimeType.startsWith("audio/")) return "\u266B";
  if (mimeType === "application/pdf") return "PDF";
  return "\u25A1";
}
