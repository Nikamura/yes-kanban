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

export interface DiffFileStats {
  additions: number;
  deletions: number;
}

export function computeFileStats(file: RawDiffFile): DiffFileStats {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
    }
  }
  return { additions, deletions };
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

export interface SplitSide {
  num: string;
  text: string;
  type: "context" | "del" | "add" | "empty";
}

export interface SplitRow {
  kind: "hunk-header" | "pair" | "meta";
  left?: SplitSide;
  right?: SplitSide;
  hunkText?: string;
  metaText?: string;
}

export function buildSplitRows(header: string, lines: string[]): SplitRow[] {
  const rows: SplitRow[] = [{ kind: "hunk-header", hunkText: header }];

  const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  let oldLine = 1;
  let newLine = 1;
  if (m?.[1] !== undefined && m[3] !== undefined) {
    oldLine = parseInt(m[1], 10);
    newLine = parseInt(m[3], 10);
  }

  const delBuf: { num: string; text: string }[] = [];
  const addBuf: { num: string; text: string }[] = [];

  const flush = () => {
    const n = Math.max(delBuf.length, addBuf.length);
    for (let i = 0; i < n; i++) {
      const d = delBuf[i];
      const a = addBuf[i];
      rows.push({
        kind: "pair",
        left: d
          ? { num: d.num, text: d.text, type: "del" }
          : { num: "", text: "", type: "empty" },
        right: a
          ? { num: a.num, text: a.text, type: "add" }
          : { num: "", text: "", type: "empty" },
      });
    }
    delBuf.length = 0;
    addBuf.length = 0;
  };

  for (const line of lines) {
    if (line.startsWith("\\")) {
      flush();
      rows.push({ kind: "meta", metaText: line.slice(1).trimStart() });
      continue;
    }
    if (line.startsWith("+")) {
      addBuf.push({ num: String(newLine), text: line.slice(1) });
      newLine += 1;
    } else if (line.startsWith("-")) {
      delBuf.push({ num: String(oldLine), text: line.slice(1) });
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      flush();
      const text = line.slice(1);
      rows.push({
        kind: "pair",
        left: { num: String(oldLine), text, type: "context" },
        right: { num: String(newLine), text, type: "context" },
      });
      oldLine += 1;
      newLine += 1;
    } else {
      flush();
      rows.push({
        kind: "pair",
        left: { num: "", text: line, type: "context" },
        right: { num: "", text: line, type: "context" },
      });
    }
  }
  flush();
  return rows;
}

/**
 * Row count for `buildSplitRows(header, lines)` without allocating row objects.
 * O(lines.length); matches `.length` of the built array. (Header does not affect count.)
 */
export function countSplitRowsForHunk(_header: string, lines: string[]): number {
  let count = 1;
  let delN = 0;
  let addN = 0;

  const flush = () => {
    count += Math.max(delN, addN);
    delN = 0;
    addN = 0;
  };

  for (const line of lines) {
    if (line.startsWith("\\")) {
      flush();
      count += 1;
      continue;
    }
    if (line.startsWith("+")) {
      addN += 1;
    } else if (line.startsWith("-")) {
      delN += 1;
    } else if (line.startsWith(" ")) {
      flush();
      count += 1;
    } else {
      flush();
      count += 1;
    }
  }
  flush();
  return count;
}

/** Unified rows per hunk: one hunk-header row plus one row per raw hunk line. */
export function countUnifiedRowsForHunk(lines: string[]): number {
  return 1 + lines.length;
}

export type FlattenDiffOptions = {
  collapsedFiles?: Set<number>;
  mode?: "unified" | "split";
};

/** One render row for virtualized unified diff (flattened from nested file/hunk structure). */
export type FlatDiffItem =
  | {
      kind: "file-header";
      fileIndex: number;
      path: string;
      status: DiffFileStatus;
      additions: number;
      deletions: number;
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
    }
  | {
      kind: "split-line";
      fileIndex: number;
      splitRow: SplitRow;
      isFirstInFile: boolean;
      isLastInFile: boolean;
    };

/**
 * Row count for the flattened diff, without allocating flat items or unified/split row arrays
 * (matches `flattenDiffFiles(files, options).length`).
 */
export function countFlatDiffRows(files: RawDiffFile[], options?: FlattenDiffOptions): number {
  const collapsed = options?.collapsedFiles;
  const mode = options?.mode ?? "unified";
  let n = 0;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    if (file === undefined) continue;
    if (collapsed?.has(fileIndex)) {
      n += 1;
      continue;
    }
    n += 1;
    if (file.isBinary) {
      n += 1;
    } else if (file.hunks.length === 0) {
      n += 1;
    } else {
      for (const hunk of file.hunks) {
        if (mode === "split") {
          n += countSplitRowsForHunk(hunk.header, hunk.lines);
        } else {
          n += countUnifiedRowsForHunk(hunk.lines);
        }
      }
    }
  }
  return n;
}

/** Flattens parsed files into a single list for windowed rendering. */
export function flattenDiffFiles(files: RawDiffFile[], options?: FlattenDiffOptions): FlatDiffItem[] {
  const collapsed = options?.collapsedFiles;
  const mode = options?.mode ?? "unified";
  const out: FlatDiffItem[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    if (file === undefined) continue;
    const stats = computeFileStats(file);
    const chunk: FlatDiffItem[] = [];

    const pushHeader = (isLast: boolean) => {
      chunk.push({
        kind: "file-header",
        fileIndex,
        path: file.path,
        status: file.status,
        additions: stats.additions,
        deletions: stats.deletions,
        isFirstInFile: true,
        isLastInFile: isLast,
      });
    };

    if (collapsed?.has(fileIndex)) {
      pushHeader(true);
      out.push(...chunk);
      continue;
    }

    pushHeader(false);

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
        if (mode === "split") {
          const splitRows = buildSplitRows(hunk.header, hunk.lines);
          for (const splitRow of splitRows) {
            chunk.push({
              kind: "split-line",
              fileIndex,
              splitRow,
              isFirstInFile: false,
              isLastInFile: false,
            });
          }
        } else {
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
    }

    if (chunk.length > 0) {
      const last = chunk[chunk.length - 1];
      if (last !== undefined) last.isLastInFile = true;
    }
    out.push(...chunk);
  }

  return out;
}
