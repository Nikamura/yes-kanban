import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  buildSplitRows,
  buildUnifiedRows,
  computeFileStats,
  countFlatDiffRows,
  flattenDiffFiles,
  splitDiffByFile,
  type FlatDiffItem,
  type FlattenDiffOptions,
  type RawDiffFile,
  type SplitRow,
  type UnifiedRow,
} from "../diffParse";

const VIRTUALIZED_DIFF_THRESHOLD = 500;
const DIFF_VIEW_MODE_KEY = "yk-diff-view-mode";
const SPLIT_MIN_WIDTH_PX = 700;

function readDiffViewMode(): "unified" | "split" {
  try {
    const raw = localStorage.getItem(DIFF_VIEW_MODE_KEY);
    if (raw === "split" || raw === "unified") return raw;
  } catch {
    /* ignore */
  }
  return "unified";
}

function writeDiffViewMode(mode: "unified" | "split") {
  try {
    localStorage.setItem(DIFF_VIEW_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

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
  const scrollFingerprint = useMemo(
    () => (diffOutput ? `${diffOutput.length}:${diffOutput.slice(0, 100)}` : ""),
    [diffOutput],
  );

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

  return <DiffViewerLoaded key={scrollFingerprint} files={files} scrollFingerprint={scrollFingerprint} />;
}

function handleCollapsibleHeaderKeyDown(e: KeyboardEvent, onActivate: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onActivate();
  }
}

/** Holds diff UI state; remount when `scrollFingerprint` changes so per-diff collapse state resets. */
function DiffViewerLoaded({
  files,
  scrollFingerprint,
}: {
  files: RawDiffFile[];
  scrollFingerprint: string;
}) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(() => new Set());
  const [viewMode, setViewMode] = useState<"unified" | "split">(() => readDiffViewMode());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [scrollFingerprint]);

  const narrow = containerWidth > 0 && containerWidth < SPLIT_MIN_WIDTH_PX;
  const effectiveMode: FlattenDiffOptions["mode"] = narrow ? "unified" : viewMode;

  const flatOptions = useMemo(
    (): FlattenDiffOptions => ({
      collapsedFiles,
      mode: effectiveMode,
    }),
    [collapsedFiles, effectiveMode],
  );

  const flatRowCount = useMemo(() => countFlatDiffRows(files, flatOptions), [files, flatOptions]);
  const useVirtual = flatRowCount > VIRTUALIZED_DIFF_THRESHOLD;
  const flatItems = useMemo(
    () => (useVirtual ? flattenDiffFiles(files, flatOptions) : []),
    [files, useVirtual, flatOptions],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollFingerprint]);

  const toggleFile = useCallback((fileIndex: number) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileIndex)) next.delete(fileIndex);
      else next.add(fileIndex);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedFiles(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedFiles(new Set(files.map((_, i) => i)));
  }, [files]);

  const setMode = useCallback((mode: "unified" | "split") => {
    setViewMode(mode);
    writeDiffViewMode(mode);
  }, []);

  return (
    <div className="diff-viewer diff-unified-wrap" ref={scrollRef}>
      <div className="diff-toolbar" role="toolbar" aria-label="Diff view options">
        <div className="diff-view-toggle" role="group" aria-label="Unified or split diff">
          <button
            type="button"
            className={effectiveMode === "unified" ? "is-active" : undefined}
            onClick={() => setMode("unified")}
          >
            Unified
          </button>
          <button
            type="button"
            className={effectiveMode === "split" ? "is-active" : undefined}
            disabled={narrow}
            onClick={() => setMode("split")}
            title={narrow ? "Split view needs a wider panel (about 700px)" : undefined}
          >
            Split
          </button>
        </div>
        <div className="diff-collapse-actions">
          <button type="button" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      </div>
      <div className="diff-unified" role="region" aria-label="Diff">
        {useVirtual ? (
          <VirtualizedDiff
            flatItems={flatItems}
            totalFiles={files.length}
            scrollRef={scrollRef}
            collapsedFiles={collapsedFiles}
            onToggleFile={toggleFile}
          />
        ) : (
          <>
            {files.map((file, fileIndex) => (
              <FileSection
                key={file.path}
                file={file}
                collapsed={collapsedFiles.has(fileIndex)}
                mode={effectiveMode}
                onToggle={() => toggleFile(fileIndex)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function FileSection({
  file,
  collapsed,
  mode,
  onToggle,
}: {
  file: RawDiffFile;
  collapsed: boolean;
  mode: "unified" | "split";
  onToggle: () => void;
}) {
  const stats = computeFileStats(file);

  return (
    <section className="diff-file-section">
      <header
        className="diff-file-section-header"
        onClick={onToggle}
        onKeyDown={(e) => handleCollapsibleHeaderKeyDown(e, onToggle)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className="diff-chevron" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className={`diff-file-status diff-file-${file.status}`}>
          {file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"}
        </span>
        <code className="diff-file-section-path">{file.path}</code>
        <span className="diff-file-stats">
          {stats.additions > 0 && (
            <span className="diff-stat-add" title="Additions">
              +{stats.additions}
            </span>
          )}
          {stats.deletions > 0 && (
            <span className="diff-stat-del" title="Deletions">
              −{stats.deletions}
            </span>
          )}
        </span>
      </header>
      {!collapsed && file.isBinary ? (
        <p className="diff-binary-note">Binary file (diff not shown)</p>
      ) : !collapsed && file.hunks.length === 0 ? (
        <p className="diff-binary-note">No textual changes in diff output</p>
      ) : !collapsed ? (
        <div className="diff-unified-pre">
          {mode === "split"
            ? file.hunks.map((hunk, hi) => <HunkBlockSplit key={`${file.path}-s-${hi}`} hunk={hunk} />)
            : file.hunks.map((hunk, hi) => <HunkBlock key={`${file.path}-${hi}`} hunk={hunk} />)}
        </div>
      ) : null}
    </section>
  );
}

function VirtualizedDiff({
  flatItems,
  totalFiles,
  scrollRef,
  collapsedFiles,
  onToggleFile,
}: {
  flatItems: FlatDiffItem[];
  totalFiles: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  collapsedFiles: Set<number>;
  onToggleFile: (fileIndex: number) => void;
}) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally non-memoizable
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
          minWidth: "100%",
          width: "max-content",
          position: "relative",
        }}
      >
        {vItems.map((virtualRow) => {
          const item = flatItems[virtualRow.index];
          if (!item) return null;
          const fileHeaderCollapsed =
            item.kind === "file-header" ? collapsedFiles.has(item.fileIndex) : false;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                minWidth: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <FlatItemRenderer
                item={item}
                totalFiles={totalFiles}
                fileHeaderCollapsed={fileHeaderCollapsed}
                onToggleFile={onToggleFile}
              />
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
    case "split-line":
      return item.splitRow.kind === "hunk-header" ? 28 : 17;
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
  fileHeaderCollapsed,
  onToggleFile,
}: {
  item: FlatDiffItem;
  totalFiles: number;
  /** Only meaningful when `item.kind === "file-header"`; parent passes `false` for other rows. */
  fileHeaderCollapsed: boolean;
  onToggleFile: (fileIndex: number) => void;
}) {
  const sectionClass = buildVirtSectionClass(item, totalFiles);

  if (item.kind === "file-header") {
    return (
      <div className={sectionClass}>
        <header
          className="diff-file-section-header"
          onClick={() => onToggleFile(item.fileIndex)}
          onKeyDown={(e) => handleCollapsibleHeaderKeyDown(e, () => onToggleFile(item.fileIndex))}
          role="button"
          tabIndex={0}
          aria-expanded={!fileHeaderCollapsed}
        >
          <span className="diff-chevron" aria-hidden="true">
            {fileHeaderCollapsed ? "▸" : "▾"}
          </span>
          <span className={`diff-file-status diff-file-${item.status}`}>
            {item.status === "added" ? "A" : item.status === "deleted" ? "D" : "M"}
          </span>
          <code className="diff-file-section-path">{item.path}</code>
          <span className="diff-file-stats">
            {item.additions > 0 && (
              <span className="diff-stat-add" title="Additions">
                +{item.additions}
              </span>
            )}
            {item.deletions > 0 && (
              <span className="diff-stat-del" title="Deletions">
                −{item.deletions}
              </span>
            )}
          </span>
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

  if (item.kind === "split-line") {
    return (
      <div className={sectionClass}>
        <SplitRowView row={item.splitRow} />
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

function HunkBlockSplit({ hunk }: { hunk: { header: string; lines: string[] } }) {
  const rows = buildSplitRows(hunk.header, hunk.lines);
  return (
    <>
      {rows.map((row, i) => (
        <SplitRowView key={i} row={row} />
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

function SplitRowView({ row }: { row: SplitRow }) {
  if (row.kind === "hunk-header") {
    return <div className="diff-hunk-header">{row.hunkText}</div>;
  }
  if (row.kind === "meta") {
    return (
      <div className="diff-split-meta-row">
        <span className="diff-split-meta-text">{row.metaText}</span>
      </div>
    );
  }
  // Remaining rows are `pair`; buildSplitRows always sets both sides. (hunk-header/meta return above.)
  const left = row.left;
  const right = row.right;
  if (left === undefined || right === undefined) {
    return null;
  }
  const rowClass = ["diff-split-line"];
  if (left.type === "context" && right.type === "context") rowClass.push("diff-split-pair-ctx");
  if (left.type === "del") rowClass.push("diff-split-left-del");
  if (right.type === "add") rowClass.push("diff-split-right-add");
  if (left.type === "empty") rowClass.push("diff-split-left-empty");
  if (right.type === "empty") rowClass.push("diff-split-right-empty");

  return (
    <div className={rowClass.join(" ")}>
      <span
        className={`diff-line-number diff-split-num-left ${
          left.type === "del" ? "diff-split-num-del" : ""
        } ${left.type === "empty" ? "diff-split-num-empty" : ""}`}
      >
        {left.num}
      </span>
      <span
        className={`diff-line-content diff-split-content-left ${
          left.type === "empty" ? "diff-split-empty-cell" : ""
        }`}
      >
        {left.text}
      </span>
      <span className="diff-split-gutter" aria-hidden />
      <span
        className={`diff-line-number diff-split-num-right ${
          right.type === "add" ? "diff-split-num-add" : ""
        } ${right.type === "empty" ? "diff-split-num-empty" : ""}`}
      >
        {right.num}
      </span>
      <span
        className={`diff-line-content diff-split-content-right ${
          right.type === "empty" ? "diff-split-empty-cell" : ""
        }`}
      >
        {right.text}
      </span>
    </div>
  );
}
