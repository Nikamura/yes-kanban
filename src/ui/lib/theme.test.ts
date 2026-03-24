import { describe, expect, test } from "bun:test";
import { resolveDocumentThemeClass } from "./theme";

describe("resolveDocumentThemeClass", () => {
  test("uses explicit light or dark when stored", () => {
    expect(resolveDocumentThemeClass("light", true)).toBe("light");
    expect(resolveDocumentThemeClass("dark", false)).toBe("dark");
  });

  test("falls back to prefersDark when stored is system, null, or other", () => {
    expect(resolveDocumentThemeClass("system", true)).toBe("dark");
    expect(resolveDocumentThemeClass("system", false)).toBe("light");
    expect(resolveDocumentThemeClass(null, true)).toBe("dark");
    expect(resolveDocumentThemeClass(null, false)).toBe("light");
  });
});
