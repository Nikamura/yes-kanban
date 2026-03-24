import { describe, expect, test } from "bun:test";
import {
  buildSplitRows,
  buildUnifiedRows,
  computeFileStats,
  countFlatDiffRows,
  countSplitRowsForHunk,
  countUnifiedRowsForHunk,
  flattenDiffFiles,
  splitDiffByFile,
} from "./diffParse";

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
    expect(files[0]!.hunks[0]?.lines).toEqual(["-line"]);
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

describe("computeFileStats", () => {
  test("counts pluses and minuses in hunks", () => {
    const files = splitDiffByFile(`diff --git a/x b/x
@@ -1,2 +1,3 @@
 a
-b
+c
 d
`);
    expect(computeFileStats(files[0]!)).toEqual({ additions: 1, deletions: 1 });
  });

  test("returns zeros for binary file", () => {
    const files = splitDiffByFile(`diff --git a/img.png b/img.png
Binary files differ
`);
    expect(computeFileStats(files[0]!)).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("buildSplitRows", () => {
  test("starts with hunk header", () => {
    const rows = buildSplitRows("@@ -1,1 +1,1 @@", []);
    expect(rows[0]).toEqual({ kind: "hunk-header", hunkText: "@@ -1,1 +1,1 @@" });
  });

  test("pure additions: pairs empty left with each add", () => {
    const rows = buildSplitRows("@@ -0,0 +1,2 @@", ["+a", "+b"]);
    const pairs = rows.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.left).toMatchObject({ type: "empty", text: "" });
    expect(pairs[0]?.right).toMatchObject({ type: "add", text: "a" });
    expect(pairs[1]?.right).toMatchObject({ type: "add", text: "b" });
  });

  test("pure deletions: pairs each del with empty right", () => {
    const rows = buildSplitRows("@@ -1,2 +0,0 @@", ["-x", "-y"]);
    const pairs = rows.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.left).toMatchObject({ type: "del", text: "x" });
    expect(pairs[0]?.right).toMatchObject({ type: "empty" });
  });

  test("modification: zips consecutive minus then plus block", () => {
    const rows = buildSplitRows("@@ -1,2 +1,2 @@", ["-old1", "-old2", "+n1", "+n2"]);
    const pairs = rows.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.left?.type).toBe("del");
    expect(pairs[0]?.right?.type).toBe("add");
  });

  test("unequal del/add counts pad with empty", () => {
    const rows = buildSplitRows("@@ -1,3 +1,1 @@", ["-a", "-b", "-c", "+x"]);
    const pairs = rows.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(3);
    expect(pairs[0]?.left?.type).toBe("del");
    expect(pairs[0]?.right?.type).toBe("add");
    expect(pairs[1]?.left?.type).toBe("del");
    expect(pairs[1]?.right?.type).toBe("empty");
    expect(pairs[2]?.left?.type).toBe("del");
    expect(pairs[2]?.right?.type).toBe("empty");
  });

  test("context lines appear on both sides", () => {
    const rows = buildSplitRows("@@ -1,1 +1,1 @@", [" ctx"]);
    const pairs = rows.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.left).toMatchObject({ type: "context", text: "ctx" });
    expect(pairs[0]?.right).toMatchObject({ type: "context", text: "ctx" });
    expect(pairs[0]?.left?.num).toBe("1");
  });

  test("meta line after flush", () => {
    const rows = buildSplitRows("@@ -1,1 +1,1 @@", ["  a", "\\ No newline"]);
    const meta = rows.find((r) => r.kind === "meta");
    expect(meta?.metaText).toBe("No newline");
  });
});

describe("countSplitRowsForHunk / countUnifiedRowsForHunk", () => {
  test("match buildSplitRows / buildUnifiedRows row counts without allocating arrays", () => {
    const hdr = "@@ -1,3 +1,1 @@";
    const lines = ["-a", "-b", "-c", "+x", " ctx", "\\ No newline"];
    expect(countSplitRowsForHunk(hdr, lines)).toBe(buildSplitRows(hdr, lines).length);
    expect(countUnifiedRowsForHunk(lines)).toBe(buildUnifiedRows(hdr, lines).length);
  });
});

describe("countFlatDiffRows", () => {
  test("matches flattenDiffFiles length for sample diffs", () => {
    expect(countFlatDiffRows([])).toBe(0);
    const multi = splitDiffByFile(`diff --git a/a.txt b/a.txt
@@ -0,0 +1,1 @@
+a
diff --git a/b.txt b/b.txt
@@ -0,0 +1,1 @@
+b
`);
    expect(countFlatDiffRows(multi)).toBe(flattenDiffFiles(multi).length);
    const binary = splitDiffByFile(`diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`);
    expect(countFlatDiffRows(binary)).toBe(flattenDiffFiles(binary).length);
  });

  test("collapsed files emit one row per file", () => {
    const multi = splitDiffByFile(`diff --git a/a.txt b/a.txt
@@ -0,0 +1,1 @@
+a
diff --git a/b.txt b/b.txt
@@ -0,0 +1,1 @@
+b
`);
    const collapsed = new Set([0, 1]);
    expect(countFlatDiffRows(multi, { collapsedFiles: collapsed })).toBe(2);
    expect(flattenDiffFiles(multi, { collapsedFiles: collapsed })).toHaveLength(2);
  });

  test("split mode row count matches flatten", () => {
    const files = splitDiffByFile(`diff --git a/x b/x
@@ -1,1 +1,1 @@
-a
+b
`);
    const opts = { mode: "split" as const };
    expect(countFlatDiffRows(files, opts)).toBe(flattenDiffFiles(files, opts).length);
  });
});

describe("flattenDiffFiles", () => {
  test("returns empty array for empty files list", () => {
    expect(flattenDiffFiles([])).toEqual([]);
  });

  test("single file with one hunk produces correct sequence and boundary flags", () => {
    const files = splitDiffByFile(`diff --git a/src/foo.ts b/src/foo.ts
index 111..222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,3 @@
 a
-b
+c
 d
`);
    const flat = flattenDiffFiles(files);
    expect(flat.length).toBeGreaterThanOrEqual(3);
    expect(flat[0]).toMatchObject({
      kind: "file-header",
      fileIndex: 0,
      path: "src/foo.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      isFirstInFile: true,
      isLastInFile: false,
    });
    expect(flat[flat.length - 1]?.isLastInFile).toBe(true);
    const kinds = flat.map((i) => i.kind);
    expect(kinds[0]).toBe("file-header");
    expect(kinds).toContain("hunk-header");
    expect(kinds).toContain("diff-line");
  });

  test("binary file yields file-header then binary-note", () => {
    const files = splitDiffByFile(`diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`);
    const flat = flattenDiffFiles(files);
    expect(flat).toEqual([
      {
        kind: "file-header",
        fileIndex: 0,
        path: "img.png",
        status: "modified",
        additions: 0,
        deletions: 0,
        isFirstInFile: true,
        isLastInFile: false,
      },
      {
        kind: "binary-note",
        fileIndex: 0,
        isFirstInFile: false,
        isLastInFile: true,
      },
    ]);
  });

  test("multiple files interleave with correct fileIndex", () => {
    const files = splitDiffByFile(`diff --git a/a.txt b/a.txt
@@ -0,0 +1,1 @@
+a
diff --git a/b.txt b/b.txt
@@ -0,0 +1,1 @@
+b
`);
    const flat = flattenDiffFiles(files);
    const headers = flat.filter((i) => i.kind === "file-header");
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({ fileIndex: 0, path: "a.txt", additions: 1, deletions: 0 });
    expect(headers[1]).toMatchObject({ fileIndex: 1, path: "b.txt", additions: 1, deletions: 0 });
    const byFile = (fi: number) => flat.filter((i) => i.fileIndex === fi);
    expect(byFile(0)[0]?.kind).toBe("file-header");
    expect(byFile(0).at(-1)?.isLastInFile).toBe(true);
    expect(byFile(1)[0]?.kind).toBe("file-header");
    expect(byFile(1).at(-1)?.isLastInFile).toBe(true);
  });

  test("file with no hunks and not binary yields header and no-changes-note", () => {
    const files = splitDiffByFile(`diff --git a/empty.txt b/empty.txt
index 111..222 100644
--- a/empty.txt
+++ b/empty.txt
`);
    const flat = flattenDiffFiles(files);
    expect(flat).toEqual([
      {
        kind: "file-header",
        fileIndex: 0,
        path: "empty.txt",
        status: "modified",
        additions: 0,
        deletions: 0,
        isFirstInFile: true,
        isLastInFile: false,
      },
      {
        kind: "no-changes-note",
        fileIndex: 0,
        isFirstInFile: false,
        isLastInFile: true,
      },
    ]);
  });

  test("split mode emits split-line items instead of diff-line", () => {
    const files = splitDiffByFile(`diff --git a/x b/x
@@ -1,1 +1,1 @@
-a
+b
`);
    const flat = flattenDiffFiles(files, { mode: "split" });
    expect(flat[0]?.kind).toBe("file-header");
    const rest = flat.slice(1);
    expect(rest.every((i) => i.kind === "split-line")).toBe(true);
    expect(rest.map((i) => (i.kind === "split-line" ? i.splitRow.kind : ""))).toEqual([
      "hunk-header",
      "pair",
    ]);
  });

  test("collapsed file omits hunks", () => {
    const files = splitDiffByFile(`diff --git a/x b/x
@@ -1,1 +1,1 @@
-a
+b
`);
    const flat = flattenDiffFiles(files, { collapsedFiles: new Set([0]) });
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({
      kind: "file-header",
      isLastInFile: true,
      additions: 1,
      deletions: 1,
    });
  });
});
