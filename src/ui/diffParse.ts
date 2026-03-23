/** Pure parsing for unified git diffs (used by DiffViewer). */

export type DiffFileStatus = "added" | "modified" | "deleted";

export interface RawDiffFile {
  path: string;
  status: DiffFileStatus;
  hunks: { header: string; lines: string[] }[];
  isBinary: boolean;
}

export type UnifiedRowKind = "hunk-header" | "context" | "add" | "del" | "meta";

export interface UnifiedRow {
  kind: UnifiedRowKind;
  text: string;
  oldNum?: string;
  newNum?: string;
}

export function splitDiffByFile(diff: string): RawDiffFile[] {
  const files: RawDiffFile[] = [];
  const lines = diff.split("\n");
  let currentFile: RawDiffFile | null = null;
  let currentHunk: { header: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      if (currentFile) files.push(currentFile);
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      currentFile = {
        path: match?.[1] ?? "unknown",
        status: "modified",
        hunks: [],
        isBinary: false,
      };
      currentHunk = null;
    } else if (currentFile && /^Binary files .*differ$/.test(line)) {
      currentFile.isBinary = true;
    } else if (line.startsWith("new file")) {
      if (currentFile) currentFile.status = "added";
    } else if (line.startsWith("deleted file")) {
      if (currentFile) currentFile.status = "deleted";
    } else if (line.startsWith("@@")) {
      currentHunk = { header: line, lines: [] };
      if (currentFile) currentFile.hunks.push(currentHunk);
    } else if (
      currentHunk &&
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line.startsWith("\\"))
    ) {
      currentHunk.lines.push(line);
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

export function buildUnifiedRows(header: string, lines: string[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [{ kind: "hunk-header", text: header }];
  const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  let oldLine = 1;
  let newLine = 1;
  if (m?.[1] !== undefined && m[3] !== undefined) {
    oldLine = parseInt(m[1], 10);
    newLine = parseInt(m[3], 10);
  }

  for (const line of lines) {
    if (line.startsWith("\\")) {
      rows.push({ kind: "meta", text: line.slice(1).trimStart(), oldNum: "", newNum: "" });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({
        kind: "add",
        text: line.slice(1),
        oldNum: "",
        newNum: String(newLine),
      });
      newLine += 1;
    } else if (line.startsWith("-")) {
      rows.push({
        kind: "del",
        text: line.slice(1),
        oldNum: String(oldLine),
        newNum: "",
      });
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      rows.push({
        kind: "context",
        text: line.slice(1),
        oldNum: String(oldLine),
        newNum: String(newLine),
      });
      oldLine += 1;
      newLine += 1;
    } else {
      rows.push({ kind: "context", text: line, oldNum: "", newNum: "" });
    }
  }

  return rows;
}

/** One render row for virtualized unified diff (flattened from nested file/hunk structure). */
export type FlatDiffItem =
  | {
      kind: "file-header";
      fileIndex: number;
      path: string;
      status: DiffFileStatus;
      isFirstInFile: boolean;
      isLastInFile: boolean;
    }
  | {
      kind: "binary-note";
      fileIndex: number;
      isFirstInFile: boolean;
      isLastInFile: boolean;
    }
  | {
      kind: "no-changes-note";
      fileIndex: number;
      isFirstInFile: boolean;
      isLastInFile: boolean;
    }
  | {
      kind: "hunk-header";
      fileIndex: number;
      text: string;
      isFirstInFile: boolean;
      isLastInFile: boolean;
    }
  | {
      kind: "diff-line";
      fileIndex: number;
      row: UnifiedRow;
      isFirstInFile: boolean;
      isLastInFile: boolean;
    };

/** Row count for the flattened diff, without allocating flat items (matches `flattenDiffFiles(files).length`). */
export function countFlatDiffRows(files: RawDiffFile[]): number {
  let n = 0;
  for (const file of files) {
    n += 1;
    if (file.isBinary) {
      n += 1;
    } else if (file.hunks.length === 0) {
      n += 1;
    } else {
      for (const hunk of file.hunks) {
        n += 1 + hunk.lines.length;
      }
    }
  }
  return n;
}

/** Flattens parsed files into a single list for windowed rendering. */
export function flattenDiffFiles(files: RawDiffFile[]): FlatDiffItem[] {
  const out: FlatDiffItem[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    if (file === undefined) continue;
    const chunk: FlatDiffItem[] = [];

    chunk.push({
      kind: "file-header",
      fileIndex,
      path: file.path,
      status: file.status,
      isFirstInFile: true,
      isLastInFile: false,
    });

    if (file.isBinary) {
      chunk.push({
        kind: "binary-note",
        fileIndex,
        isFirstInFile: false,
        isLastInFile: false,
      });
    } else if (file.hunks.length === 0) {
      chunk.push({
        kind: "no-changes-note",
        fileIndex,
        isFirstInFile: false,
        isLastInFile: false,
      });
    } else {
      for (const hunk of file.hunks) {
        const rows = buildUnifiedRows(hunk.header, hunk.lines);
        for (const row of rows) {
          if (row.kind === "hunk-header") {
            chunk.push({
              kind: "hunk-header",
              fileIndex,
              text: row.text,
              isFirstInFile: false,
              isLastInFile: false,
            });
          } else {
            chunk.push({
              kind: "diff-line",
              fileIndex,
              row,
              isFirstInFile: false,
              isLastInFile: false,
            });
          }
        }
      }
    }

    if (chunk.length > 0) {
      const last = chunk[chunk.length - 1];
      if (last !== undefined) last.isLastInFile = true;
    }
    out.push(...chunk);
  }

  return out;
}
