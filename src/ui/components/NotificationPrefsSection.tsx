import { useState } from "react";
import { getNotificationPrefs, setNotificationPrefs } from "../hooks/useNotifications";
import {
  isNotificationSoundId,
  notificationSoundSelectOptions,
  playNotificationSound,
} from "../lib/notificationSounds";

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
        <div className="setting-item">
          <label>Notification sound</label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={prefs.sound ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  save({ ...prefs, sound: null });
                } else if (isNotificationSoundId(v)) {
                  save({ ...prefs, sound: v });
                }
              }}
            >
              <option value="">Off</option>
              {notificationSoundSelectOptions().map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={prefs.sound === null}
              onClick={() => {
                if (prefs.sound !== null) void playNotificationSound(prefs.sound);
              }}
            >
              Preview
            </button>
          </div>
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
