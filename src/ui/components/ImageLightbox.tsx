import { useEscapeClose } from "../hooks/useEscapeClose";

export function ImageLightbox({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  useEscapeClose(onClose, { capture: true, stopPropagation: true });
  return (
    <div
      className="dialog-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      style={{ zIndex: 200 }}
    >
      <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="image-lightbox-close" onClick={onClose}>
          &times;
        </button>
        <img src={url} alt={filename} className="image-lightbox-img" />
        <div className="image-lightbox-caption">{filename}</div>
      </div>
    </div>
  );
}
