import { expect, test, describe } from "bun:test";
import { escapeCsv } from "./csvHelpers";

describe("escapeCsv", () => {
  test("returns plain values unchanged", () => {
    expect(escapeCsv("hello")).toBe("hello");
    expect(escapeCsv("Bug fix")).toBe("Bug fix");
  });

  test("returns empty string unchanged", () => {
    expect(escapeCsv("")).toBe("");
  });

  test("quotes values containing commas", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
  });

  test("quotes values containing newlines", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });

  test("escapes double quotes", () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  describe("formula injection prevention", () => {
    test("prefixes = with single quote", () => {
      expect(escapeCsv("=CMD()")).toBe("'=CMD()");
    });

    test("prefixes + with single quote", () => {
      expect(escapeCsv("+1")).toBe("'+1");
    });

    test("prefixes - with single quote", () => {
      expect(escapeCsv("-1")).toBe("'-1");
    });

    test("prefixes @ with single quote", () => {
      expect(escapeCsv("@SUM")).toBe("'@SUM");
    });

    test("sanitizes and quotes when formula char AND comma present", () => {
      expect(escapeCsv("=foo,bar")).toBe("\"'=foo,bar\"");
    });

    test("sanitizes and quotes when formula char AND double quote present", () => {
      expect(escapeCsv('=CMD("calc")')).toBe("\"'=CMD(\"\"calc\"\")\"");
    });

    test("sanitizes and quotes when formula char AND newline present", () => {
      expect(escapeCsv("=A1\n+B2")).toBe("\"'=A1\n+B2\"");
    });
  });
});
