import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  buildUnifiedRows,
  countFlatDiffRows,
  flattenDiffFiles,
  splitDiffByFile,
  type FlatDiffItem,
  type UnifiedRow,
} from "../diffParse";

const VIRTUALIZED_DIFF_THRESHOLD = 500;

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
  const flatRowCount = useMemo(() => countFlatDiffRows(files), [files]);
  const useVirtual = flatRowCount > VIRTUALIZED_DIFF_THRESHOLD;
  const flatItems = useMemo(
    () => (useVirtual ? flattenDiffFiles(files) : []),
    [files, useVirtual],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFingerprint = useMemo(
    () => (diffOutput ? `${diffOutput.length}:${diffOutput.slice(0, 100)}` : ""),
    [diffOutput],
  );

  useEffect(() => {
    if (!scrollFingerprint) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollFingerprint]);

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
    <div className="diff-viewer diff-unified-wrap" ref={scrollRef}>
      <div className="diff-unified" role="region" aria-label="Unified diff">
        {useVirtual ? (
          <VirtualizedDiff flatItems={flatItems} totalFiles={files.length} scrollRef={scrollRef} />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

function VirtualizedDiff({
  flatItems,
  totalFiles,
  scrollRef,
}: {
  flatItems: FlatDiffItem[];
  totalFiles: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateFlatItemSize(flatItems[index]),
    overscan: 30,
    measureElement,
    getItemKey: (index) => {
      const item = flatItems[index];
      if (!item) return index;
      return `${item.fileIndex}-${item.kind}-${index}`;
    },
  });

  const vItems = virtualizer.getVirtualItems();

  return (
    <div className="diff-unified-pre">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {vItems.map((virtualRow) => {
          const item = flatItems[virtualRow.index];
          if (!item) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <FlatItemRenderer item={item} totalFiles={totalFiles} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function estimateFlatItemSize(item: FlatDiffItem | undefined): number {
  if (!item) return 17;
  switch (item.kind) {
    case "file-header":
      return 38;
    case "binary-note":
    case "no-changes-note":
      return 28;
    case "hunk-header":
      return 28;
    case "diff-line":
      return 17;
  }
}

function buildVirtSectionClass(item: FlatDiffItem, totalFiles: number): string {
  const classes = ["diff-virt-row", "diff-virt-file-body"];
  if (item.isFirstInFile) classes.push("diff-virt-file-first");
  if (item.isLastInFile) {
    classes.push("diff-virt-file-last");
    if (item.fileIndex < totalFiles - 1) classes.push("diff-virt-file-gap-after");
  }
  return classes.join(" ");
}

const FlatItemRenderer = memo(function FlatItemRenderer({
  item,
  totalFiles,
}: {
  item: FlatDiffItem;
  totalFiles: number;
}) {
  const sectionClass = buildVirtSectionClass(item, totalFiles);

  if (item.kind === "file-header") {
    return (
      <div className={sectionClass}>
        <header className="diff-file-section-header">
          <span className={`diff-file-status diff-file-${item.status}`}>
            {item.status === "added" ? "A" : item.status === "deleted" ? "D" : "M"}
          </span>
          <code className="diff-file-section-path">{item.path}</code>
        </header>
      </div>
    );
  }

  if (item.kind === "binary-note") {
    return (
      <div className={sectionClass}>
        <p className="diff-binary-note">Binary file (diff not shown)</p>
      </div>
    );
  }

  if (item.kind === "no-changes-note") {
    return (
      <div className={sectionClass}>
        <p className="diff-binary-note">No textual changes in diff output</p>
      </div>
    );
  }

  if (item.kind === "hunk-header") {
    return (
      <div className={sectionClass}>
        <div className="diff-hunk-header">{item.text}</div>
      </div>
    );
  }

  return (
    <div className={sectionClass}>
      <UnifiedRowView row={item.row} />
    </div>
  );
});

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
