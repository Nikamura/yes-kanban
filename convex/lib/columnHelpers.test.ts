import { describe, expect, test } from "bun:test";
import { getNextVisibleColumn } from "./columnHelpers";

const DEFAULT_COLUMNS = [
  { name: "Backlog", position: 0, visible: true, autoDispatch: false },
  { name: "To Do", position: 1, visible: true, autoDispatch: true },
  { name: "In Progress", position: 2, visible: true, autoDispatch: false },
  { name: "Done", position: 3, visible: true, autoDispatch: false },
];

describe("getNextVisibleColumn", () => {
  test("returns next visible column by position", () => {
    const result = getNextVisibleColumn(DEFAULT_COLUMNS, "To Do");
    expect(result?.name).toBe("In Progress");
  });

  test("skips hidden columns", () => {
    const columns = [
      { name: "A", position: 0, visible: true, autoDispatch: false },
      { name: "B", position: 1, visible: false, autoDispatch: false },
      { name: "C", position: 2, visible: true, autoDispatch: false },
    ];
    const result = getNextVisibleColumn(columns, "A");
    expect(result?.name).toBe("C");
  });

  test("returns null for last visible column", () => {
    const result = getNextVisibleColumn(DEFAULT_COLUMNS, "Done");
    expect(result).toBeNull();
  });

  test("returns null for unknown column", () => {
    const result = getNextVisibleColumn(DEFAULT_COLUMNS, "NonExistent");
    expect(result).toBeNull();
  });

  test("In Progress -> Done", () => {
    const result = getNextVisibleColumn(DEFAULT_COLUMNS, "In Progress");
    expect(result?.name).toBe("Done");
  });

  test("works with non-sequential positions", () => {
    const columns = [
      { name: "X", position: 10, visible: true, autoDispatch: false },
      { name: "Y", position: 50, visible: true, autoDispatch: false },
      { name: "Z", position: 100, visible: true, autoDispatch: false },
    ];
    const result = getNextVisibleColumn(columns, "X");
    expect(result?.name).toBe("Y");
  });

  test("works with single visible column", () => {
    const columns = [
      { name: "Only", position: 0, visible: true, autoDispatch: false },
    ];
    const result = getNextVisibleColumn(columns, "Only");
    expect(result).toBeNull();
  });
});
