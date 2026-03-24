/**
 * Theme resolution for `<html class="light|dark">`.
 * The inline script in `index.html` runs before paint; `ThemeProvider` syncs after React mounts.
 * Keep the three-way branch (explicit light/dark vs system) aligned with that script.
 */
export const THEME_STORAGE_KEY = "yes-kanban-theme";

export type ThemePreference = "light" | "dark" | "system";

/** Which `light`/`dark` class to set from a raw localStorage value + system dark preference. */
export function resolveDocumentThemeClass(
  storedRaw: string | null,
  prefersDark: boolean
): "light" | "dark" {
  if (storedRaw === "light" || storedRaw === "dark") return storedRaw;
  return prefersDark ? "dark" : "light";
}

export function applyHtmlClass(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

export function readStoredThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

export function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
