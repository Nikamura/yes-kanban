import { useState } from "react";
import { getNotificationPrefs, setNotificationPrefs } from "../hooks/useNotifications";
import { Button } from "@/ui/components/ui/button";
import { Label } from "@/ui/components/ui/label";

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
    <section className="mb-8 max-w-[800px] space-y-3">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Browser Permission</label>
          <span className="text-sm">
            {permissionState === "granted" ? (
              "Granted"
            ) : permissionState === "denied" ? (
              "Denied (update in browser settings)"
            ) : permissionState === "unsupported" ? (
              "Not supported"
            ) : (
              <Button size="sm" onClick={requestPermission}>
                Enable
              </Button>
            )}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <Label className="flex cursor-pointer items-center gap-2 font-normal">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={prefs.enabled}
            onChange={(e) => save({ ...prefs, enabled: e.target.checked })}
          />
          Enable notifications
        </Label>
        <Label className="flex cursor-pointer items-center gap-2 font-normal">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={prefs.events.completed}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, completed: e.target.checked } })
            }
          />
          Task completed
        </Label>
        <Label className="flex cursor-pointer items-center gap-2 font-normal">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={prefs.events.merged}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, merged: e.target.checked } })
            }
          />
          Changes merged
        </Label>
        <Label className="flex cursor-pointer items-center gap-2 font-normal">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={prefs.events.failed}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, failed: e.target.checked } })
            }
          />
          Task failed
        </Label>
        <Label className="flex cursor-pointer items-center gap-2 font-normal">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={prefs.events.question}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, question: e.target.checked } })
            }
          />
          Agent has a question
        </Label>
        <Label className="flex cursor-pointer items-center gap-2 font-normal">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={prefs.events.planSubmitted}
            onChange={(e) =>
              save({ ...prefs, events: { ...prefs.events, planSubmitted: e.target.checked } })
            }
          />
          Plan ready for review
        </Label>
      </div>
    </section>
  );
}
