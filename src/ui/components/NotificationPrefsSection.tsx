import { useState } from "react";
import { getNotificationPrefs, setNotificationPrefs } from "../hooks/useNotifications";

export function NotificationPrefsSection() {
  const [prefs, setPrefs] = useState(getNotificationPrefs);
  const [permissionState, setPermissionState] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  const save = (updated: typeof prefs) => {
    setPrefs(updated);
    setNotificationPrefs(updated);
  };

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermissionState(result);
  };

  return (
    <section className="settings-section">
      <h2>Notifications</h2>
      <div className="settings-grid">
        <div className="setting-item">
          <label>Browser Permission</label>
          <span>
            {permissionState === "granted" ? (
              "Granted"
            ) : permissionState === "denied" ? (
              "Denied (update in browser settings)"
            ) : permissionState === "unsupported" ? (
              "Not supported"
            ) : (
              <button className="btn btn-sm btn-primary" onClick={requestPermission}>
                Enable
              </button>
            )}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={prefs.enabled}
            onChange={(e) => save({ ...prefs, enabled: e.target.checked })}
          />
          Enable notifications
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={prefs.events.completed}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, completed: e.target.checked } })
            }
          />
          Task completed
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={prefs.events.merged}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, merged: e.target.checked } })
            }
          />
          Changes merged
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={prefs.events.failed}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, failed: e.target.checked } })
            }
          />
          Task failed
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={prefs.events.question}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, question: e.target.checked } })
            }
          />
          Agent has a question
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={prefs.events.planSubmitted}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, planSubmitted: e.target.checked } })
            }
          />
          Plan ready for review
        </label>
      </div>
    </section>
  );
}
