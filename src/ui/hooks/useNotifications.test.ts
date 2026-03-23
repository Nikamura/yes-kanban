import { describe, it, expect, beforeEach, beforeAll } from "bun:test";
import { getNotificationPrefs } from "./useNotifications";

const PREFS_KEY = "yk-notification-prefs";

describe("getNotificationPrefs", () => {
  const store = new Map<string, string>();

  beforeAll(() => {
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  beforeEach(() => {
    store.clear();
  });

  it("defaults sound to null when unset", () => {
    expect(getNotificationPrefs().sound).toBeNull();
  });

  it("migrates legacy sound true to chime", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sound: true }));
    expect(getNotificationPrefs().sound).toBe("chime");
  });

  it("migrates legacy sound false to null", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sound: false }));
    expect(getNotificationPrefs().sound).toBeNull();
  });

  it("preserves string sound ids", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sound: "bell" }));
    expect(getNotificationPrefs().sound).toBe("bell");
  });
});
