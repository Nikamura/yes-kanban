import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  onNewIssue?: () => void;
  onSwitchColumn?: (index: number) => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onOpenFocused?: () => void;
  onFocusSearch?: () => void;
  onShowHelp?: () => void;
  onMoveFocused?: () => void;
  onSetPriority?: () => void;
  onCommandPalette?: () => void;
}

function isInputFocused(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);

  // Update the ref in an effect to avoid "cannot access refs during render"
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Cmd+K / Ctrl+K before modifier guard
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handlersRef.current.onCommandPalette?.();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInputFocused(e.target)) return;

      const h = handlersRef.current;
      switch (e.key) {
        case "n":
        case "c":
          e.preventDefault();
          h.onNewIssue?.();
          break;
        case "m":
          e.preventDefault();
          h.onMoveFocused?.();
          break;
        case "p":
          e.preventDefault();
          h.onSetPriority?.();
          break;
        case "j":
          e.preventDefault();
          h.onNavigateDown?.();
          break;
        case "k":
          e.preventDefault();
          h.onNavigateUp?.();
          break;
        case "Enter":
          e.preventDefault();
          h.onOpenFocused?.();
          break;
        case "/":
          e.preventDefault();
          h.onFocusSearch?.();
          break;
        case "?":
          e.preventDefault();
          h.onShowHelp?.();
          break;
        default:
          if (e.key >= "1" && e.key <= "9") {
            e.preventDefault();
            h.onSwitchColumn?.(parseInt(e.key) - 1);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
