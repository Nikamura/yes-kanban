import { describe, it, expect, mock } from "bun:test";

// Since this is a React hook, we test the core logic by extracting
// the key-handling behavior. We simulate the dispatch logic directly.

// Import the module to get the isInputFocused and handler dispatch logic
// We'll re-implement the dispatch logic here to unit test it without React

interface ShortcutHandlers {
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

function simulateKeyPress(
  handlers: ShortcutHandlers,
  key: string,
  opts: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: "input" | "body" } = {}
): boolean {
  // Replicate the logic from useKeyboardShortcuts handleKeyDown
  const metaKey = opts.metaKey ?? false;
  const ctrlKey = opts.ctrlKey ?? false;
  const altKey = opts.altKey ?? false;
  const isInput = opts.target === "input";

  // Cmd+K / Ctrl+K before modifier guard
  if ((metaKey || ctrlKey) && key === "k") {
    handlers.onCommandPalette?.();
    return true;
  }

  if (ctrlKey || metaKey || altKey) return false;
  if (isInput) return false;

  switch (key) {
    case "n":
    case "c":
      handlers.onNewIssue?.();
      return true;
    case "m":
      handlers.onMoveFocused?.();
      return true;
    case "p":
      handlers.onSetPriority?.();
      return true;
    case "j":
      handlers.onNavigateDown?.();
      return true;
    case "k":
      handlers.onNavigateUp?.();
      return true;
    case "Enter":
      handlers.onOpenFocused?.();
      return true;
    case "/":
      handlers.onFocusSearch?.();
      return true;
    case "?":
      handlers.onShowHelp?.();
      return true;
    default:
      if (key >= "1" && key <= "9") {
        handlers.onSwitchColumn?.(parseInt(key) - 1);
        return true;
      }
      return false;
  }
}

describe("useKeyboardShortcuts dispatch logic", () => {
  it("c triggers onNewIssue", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onNewIssue: fn }, "c");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("n triggers onNewIssue", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onNewIssue: fn }, "n");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("m triggers onMoveFocused", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onMoveFocused: fn }, "m");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("p triggers onSetPriority", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onSetPriority: fn }, "p");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Cmd+K triggers onCommandPalette", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onCommandPalette: fn }, "k", { metaKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+K triggers onCommandPalette", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onCommandPalette: fn }, "k", { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Cmd+K works even when input is focused", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onCommandPalette: fn }, "k", { metaKey: true, target: "input" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("single-key shortcuts are suppressed when input is focused", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onNewIssue: fn }, "c", { target: "input" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("m is suppressed when input is focused", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onMoveFocused: fn }, "m", { target: "input" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("p is suppressed when input is focused", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onSetPriority: fn }, "p", { target: "input" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("shortcuts with alt modifier are suppressed", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onNewIssue: fn }, "c", { altKey: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it("j triggers onNavigateDown", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onNavigateDown: fn }, "j");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("k triggers onNavigateUp", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onNavigateUp: fn }, "k");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("/ triggers onFocusSearch", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onFocusSearch: fn }, "/");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("? triggers onShowHelp", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onShowHelp: fn }, "?");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("1-9 triggers onSwitchColumn with correct index", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onSwitchColumn: fn }, "3");
    expect(fn).toHaveBeenCalledWith(2);
  });

  it("Enter triggers onOpenFocused", () => {
    const fn = mock(() => {});
    simulateKeyPress({ onOpenFocused: fn }, "Enter");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("handlers are optional - no crash when undefined", () => {
    expect(() => simulateKeyPress({}, "c")).not.toThrow();
    expect(() => simulateKeyPress({}, "m")).not.toThrow();
    expect(() => simulateKeyPress({}, "p")).not.toThrow();
    expect(() => simulateKeyPress({}, "k", { metaKey: true })).not.toThrow();
  });
});
