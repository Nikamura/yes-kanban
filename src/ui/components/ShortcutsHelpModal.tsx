import { useEscapeClose } from "../hooks/useEscapeClose";
import { Button } from "@/ui/components/ui/button";

const SHORTCUTS = [
  { key: "c / n", description: "New issue" },
  { key: "j", description: "Navigate down" },
  { key: "k", description: "Navigate up" },
  { key: "Enter", description: "Open focused issue" },
  { key: "m", description: "Move focused issue" },
  { key: "/", description: "Focus search" },
  { key: "⌘K", description: "Command palette" },
  { key: "1-9", description: "Switch column" },
  { key: "?", description: "Show this help" },
  { key: "Esc", description: "Close panel / modal" },
] as const;

export function ShortcutsHelpModal({ onClose }: { onClose: () => void }) {
  useEscapeClose(onClose);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card p-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">Keyboard Shortcuts</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.key} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-2 align-top">
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{s.key}</kbd>
                </td>
                <td className="py-1.5 text-muted-foreground">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
