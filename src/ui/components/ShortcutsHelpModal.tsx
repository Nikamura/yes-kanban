import { useEscapeClose } from "../hooks/useEscapeClose";

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
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <h2>Keyboard Shortcuts</h2>
        <table className="shortcuts-table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.key}>
                <td>
                  <kbd className="shortcut-key">{s.key}</kbd>
                </td>
                <td>{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
