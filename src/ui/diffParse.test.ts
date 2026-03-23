import { describe, expect, test } from "bun:test";
import { buildUnifiedRows, splitDiffByFile } from "./diffParse";

describe("splitDiffByFile", () => {
  test("returns empty array for empty diff", () => {
    expect(splitDiffByFile("")).toEqual([]);
  });

  test("parses path and modified status from diff --git", () => {
    const d = `diff --git a/src/foo.ts b/src/foo.ts
index 111..222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,3 @@
 a
-b
+c
 d
`;
    const files = splitDiffByFile(d);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/foo.ts");
    expect(files[0]!.status).toBe("modified");
    expect(files[0]!.isBinary).toBe(false);
    expect(files[0]!.hunks).toHaveLength(1);
    expect(files[0]!.hunks[0]!.header).toMatch(/^@@/);
    expect(files[0]!.hunks[0]!.lines).toEqual([" a", "-b", "+c", " d"]);
  });

  test("detects added file", () => {
    const d = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,1 @@
+hello
`;
    const files = splitDiffByFile(d);
    expect(files[0]!.status).toBe("added");
  });

  test("detects deleted file", () => {
    const d = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-line
`;
    const files = splitDiffByFile(d);
    expect(files[0]!.status).toBe("deleted");
  });

  test("marks binary when git reports binary diff", () => {
    const d = `diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;
    const files = splitDiffByFile(d);
    expect(files[0]!.isBinary).toBe(true);
    expect(files[0]!.hunks).toHaveLength(0);
  });

  test("splits multiple files", () => {
    const d = `diff --git a/a.txt b/a.txt
@@ -0,0 +1,1 @@
+a
diff --git a/b.txt b/b.txt
@@ -0,0 +1,1 @@
+b
`;
    const files = splitDiffByFile(d);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
  });
});

describe("buildUnifiedRows", () => {
  test("starts with hunk header row", () => {
    const rows = buildUnifiedRows("@@ -10,7 +10,8 @@ fn foo()", []);
    expect(rows[0]).toEqual({ kind: "hunk-header", text: "@@ -10,7 +10,8 @@ fn foo()" });
  });

  test("assigns line numbers for delete and add without context", () => {
    const rows = buildUnifiedRows("@@ -1,2 +1,2 @@", ["-old", "+new"]);
    expect(rows.find((r) => r.kind === "del")).toMatchObject({
      kind: "del",
      text: "old",
      oldNum: "1",
      newNum: "",
    });
    expect(rows.find((r) => r.kind === "add")).toMatchObject({
      kind: "add",
      text: "new",
      oldNum: "",
      newNum: "1",
    });
  });

  test("increments old and new for context lines", () => {
    const rows = buildUnifiedRows("@@ -5,2 +7,2 @@", ["  x", "  y"]);
    const ctx = rows.filter((r) => r.kind === "context");
    expect(ctx[0]).toMatchObject({ oldNum: "5", newNum: "7" });
    expect(ctx[1]).toMatchObject({ oldNum: "6", newNum: "8" });
  });

  test("handles no newline at end of file marker", () => {
    const rows = buildUnifiedRows("@@ -1,1 +1,1 @@", [" line", "\\ No newline at end of file"]);
    const meta = rows.find((r) => r.kind === "meta");
    expect(meta?.text).toBe("No newline at end of file");
  });
});
