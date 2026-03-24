import { describe, expect, test } from "bun:test";
import { wsStatusStyle } from "./wsStatusColors";

describe("wsStatusStyle", () => {
  test("returns known palette for coding", () => {
    expect(wsStatusStyle("coding")).toEqual({
      color: "#F59E0B",
      backgroundColor: "rgba(245, 158, 11, 0.1)",
    });
  });

  test("falls back to muted for unknown status", () => {
    expect(wsStatusStyle("totally_unknown_status_xyz")).toEqual({
      color: "var(--muted-foreground)",
      backgroundColor: "var(--muted)",
    });
  });
});
