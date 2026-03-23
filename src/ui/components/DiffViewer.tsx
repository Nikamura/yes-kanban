import { useMemo } from "react";
import { buildUnifiedRows, splitDiffByFile, type UnifiedRow } from "../diffParse";

interface DiffWorktreeInfo {
  repoPath: string;
  baseBranch: string;
  branchName: string;
  worktreePath: string;
}

interface DiffViewerProps {
  worktrees: DiffWorktreeInfo[];
  diffOutput?: string;
}

export function DiffViewer({ worktrees, diffOutput }: DiffViewerProps) {
  const files = useMemo(() => (diffOutput ? splitDiffByFile(diffOutput) : []), [diffOutput]);

  if (!diffOutput) {
    return (
      <div className="diff-viewer">
        {worktrees.map((wt) => (
          <div key={wt.worktreePath} className="diff-worktree">
            <div className="diff-worktree-header">
              <code>{wt.branchName}</code>
              <span className="meta-value">vs {wt.baseBranch}</span>
            </div>
            <div className="diff-placeholder">
              <p>Diff will appear here as the agent makes changes.</p>
              <p>
                <code>
                  git diff {wt.baseBranch}..{wt.branchName}
                </code>
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="diff-viewer">
        <div className="diff-placeholder">
          <p>No file changes detected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer diff-unified-wrap">
      <div className="diff-unified" role="region" aria-label="Unified diff">
        {files.map((file) => (
          <section key={file.path} className="diff-file-section">
            <header className="diff-file-section-header">
              <span className={`diff-file-status diff-file-${file.status}`}>
                {file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"}
              </span>
              <code className="diff-file-section-path">{file.path}</code>
            </header>
            {file.isBinary ? (
              <p className="diff-binary-note">Binary file (diff not shown)</p>
            ) : file.hunks.length === 0 ? (
              <p className="diff-binary-note">No textual changes in diff output</p>
            ) : (
              <div className="diff-unified-pre">
                {file.hunks.map((hunk, hi) => (
                  <HunkBlock key={`${file.path}-${hi}`} hunk={hunk} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function HunkBlock({ hunk }: { hunk: { header: string; lines: string[] } }) {
  const rows = buildUnifiedRows(hunk.header, hunk.lines);

  return (
    <>
      {rows.map((row, i) => (
        <UnifiedRowView key={i} row={row} />
      ))}
    </>
  );
}

function UnifiedRowView({ row }: { row: UnifiedRow }) {
  if (row.kind === "hunk-header") {
    return <div className="diff-hunk-header">{row.text}</div>;
  }
  const lineClass =
    row.kind === "add"
      ? "diff-line diff-line-add"
      : row.kind === "del"
        ? "diff-line diff-line-del"
        : row.kind === "meta"
          ? "diff-line diff-line-meta"
          : "diff-line diff-line-context";
  return (
    <div className={lineClass}>
      <span className="diff-line-number diff-line-number-old">{row.oldNum ?? ""}</span>
      <span className="diff-line-number diff-line-number-new">{row.newNum ?? ""}</span>
      <span className="diff-line-content">{row.text}</span>
    </div>
  );
}
