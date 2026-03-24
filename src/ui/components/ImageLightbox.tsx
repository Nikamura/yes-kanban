import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Button } from "@/ui/components/ui/button";
import { XIcon } from "lucide-react";

export function ImageLightbox({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-[min(96vw,1200px)] gap-3 overflow-hidden border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[min(96vw,1200px)]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{filename}</DialogTitle>
        <DialogDescription className="sr-only">
          Full-size preview of the attachment.
        </DialogDescription>
        <div className="relative flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute top-2 right-2 z-10"
            onClick={onClose}
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </Button>
          <img
            src={url}
            alt={filename}
            className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
          />
          <div className="text-muted-foreground truncate text-center text-sm">
            {filename}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
