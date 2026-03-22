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
 */
export function useEscapeClose(
  onClose: () => void,
  options?: UseEscapeCloseOptions,
) {
  const onCloseRef = useRef(onClose);
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
