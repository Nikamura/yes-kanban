import { useEffect, useRef } from "react";

export type UseEscapeCloseOptions = {
  /** Run in capture phase so this handler runs before bubble listeners (e.g. parent dialogs). */
  capture?: boolean;
  /** Call before onClose so other document listeners do not run (pair with capture for nested overlays). */
  stopPropagation?: boolean;
};

/**
 * Registers a document keydown listener for Escape. Uses a ref for the callback so the listener
 * stays registered once per options tuple and always invokes the latest handler (no stale closures).
 *
 * Used for non-Dialog overlays (e.g. issue detail sheet, shortcuts help). Shadcn `Dialog` handles
 * Escape internally; do not use this hook alongside a Base UI Dialog for the same surface.
 */
export function useEscapeClose(
  onClose: () => void,
  options?: UseEscapeCloseOptions,
) {
  const onCloseRef = useRef(onClose);
  // Sync latest callback synchronously on every render so Escape before the first effect paint
  // still sees the current handler (eslint react-hooks/refs disallows this; intentional here).
  // eslint-disable-next-line react-hooks/refs -- ref-as-stable-callback pattern; not used for render output
  onCloseRef.current = onClose;
  const capture = options?.capture ?? false;
  const stopPropagation = options?.stopPropagation ?? false;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stopPropagation) {
        e.stopPropagation();
      }
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown, capture);
    return () => document.removeEventListener("keydown", handleKeyDown, capture);
  }, [capture, stopPropagation]);
}
