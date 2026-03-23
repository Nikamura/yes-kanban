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
