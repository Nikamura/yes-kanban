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
import { cn } from "@/ui/lib/utils";
import { Button } from "@/ui/components/ui/button";
import {
  diffBinaryNoteClass,
  diffFileStatusTextClass,
  diffHunkHeaderClass,
  diffLineContentClass,
  diffLineNumClass,
  diffUnifiedPreClass,
  diffVirtSectionClass,
} from "@/ui/lib/diffUi";

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
      <div className="box-border flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-3">
        {worktrees.map((wt) => (
          <div key={wt.worktreePath} className="mb-5">
            <div className="mb-2 flex items-center gap-2 rounded-sm bg-secondary px-3 py-2">
              <code className="font-mono text-[13px]">{wt.branchName}</code>
              <span className="font-mono text-xs text-muted-foreground">vs {wt.baseBranch}</span>
            </div>
            <div className="px-6 py-8 text-center text-[13px] text-muted-foreground">
              <p>Diff will appear here as the agent makes changes.</p>
              <p className="mt-2">
                <code className="mt-2 block font-mono text-[12px]">
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
      <div className="box-border flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <div className="px-6 py-8 text-center text-[13px] text-muted-foreground">
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
    <div
      className="box-border flex min-h-0 flex-1 flex-col overflow-y-auto p-3"
      ref={scrollRef}
    >
      <div
        className="mb-2 flex flex-wrap items-center gap-2"
        data-testid="diff-toolbar"
        role="toolbar"
        aria-label="Diff view options"
      >
        <div className="flex gap-1 rounded-md border border-border p-0.5" role="group" aria-label="Unified or split diff">
          <Button
            type="button"
            size="sm"
            variant={effectiveMode === "unified" ? "default" : "outline"}
            aria-pressed={effectiveMode === "unified"}
            data-testid="diff-view-toggle-unified"
            onClick={() => setMode("unified")}
          >
            Unified
          </Button>
          <Button
            type="button"
            size="sm"
            variant={effectiveMode === "split" ? "default" : "outline"}
            aria-pressed={effectiveMode === "split"}
            data-testid="diff-view-toggle-split"
            disabled={narrow}
            onClick={() => setMode("split")}
            title={narrow ? "Split view needs a wider panel (about 700px)" : undefined}
          >
            Split
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="outline" onClick={expandAll}>
            Expand all
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={collapseAll}>
            Collapse all
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1" role="region" aria-label="Diff">
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
    <section className="mb-4 overflow-hidden rounded-sm border border-border bg-card" data-testid="diff-file-section">
      <header
        className="flex cursor-pointer items-center gap-2 border-b border-border bg-secondary px-3 py-2 text-[13px]"
        data-testid="diff-file-section-header"
        onClick={onToggle}
        onKeyDown={(e) => handleCollapsibleHeaderKeyDown(e, onToggle)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className="w-3 shrink-0 text-center text-muted-foreground" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span
          className={cn("w-[18px] shrink-0 text-center text-[11px] font-bold", diffFileStatusTextClass(file.status))}
          data-testid="diff-file-status"
        >
          {file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"}
        </span>
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-foreground" data-testid="diff-file-section-path">
          {file.path}
        </code>
        <span className="flex shrink-0 gap-2 font-mono text-xs">
          {stats.additions > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400" title="Additions" data-testid="diff-stat-add">
              +{stats.additions}
            </span>
          )}
          {stats.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400" title="Deletions" data-testid="diff-stat-del">
              −{stats.deletions}
            </span>
          )}
        </span>
      </header>
      {!collapsed && file.isBinary ? (
        <p className={diffBinaryNoteClass}>Binary file (diff not shown)</p>
      ) : !collapsed && file.hunks.length === 0 ? (
        <p className={diffBinaryNoteClass}>No textual changes in diff output</p>
      ) : !collapsed ? (
        <div className={diffUnifiedPreClass} data-testid="diff-unified-pre">
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
    <div className={diffUnifiedPreClass} data-testid="diff-unified-pre">
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
  const sectionClass = diffVirtSectionClass(item, totalFiles);

  if (item.kind === "file-header") {
    return (
      <div className={sectionClass} data-testid="diff-file-section">
        <header
          className="flex cursor-pointer items-center gap-2 border-b border-border bg-secondary px-3 py-2 text-[13px]"
          data-testid="diff-file-section-header"
          onClick={() => onToggleFile(item.fileIndex)}
          onKeyDown={(e) => handleCollapsibleHeaderKeyDown(e, () => onToggleFile(item.fileIndex))}
          role="button"
          tabIndex={0}
          aria-expanded={!fileHeaderCollapsed}
        >
          <span className="w-3 shrink-0 text-center text-muted-foreground" aria-hidden="true">
            {fileHeaderCollapsed ? "▸" : "▾"}
          </span>
          <span
            className={cn("w-[18px] shrink-0 text-center text-[11px] font-bold", diffFileStatusTextClass(item.status))}
            data-testid="diff-file-status"
          >
            {item.status === "added" ? "A" : item.status === "deleted" ? "D" : "M"}
          </span>
          <code className="min-w-0 flex-1 break-all font-mono text-[13px]" data-testid="diff-file-section-path">
            {item.path}
          </code>
          <span className="flex shrink-0 gap-2 font-mono text-xs">
            {item.additions > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400" title="Additions" data-testid="diff-stat-add">
                +{item.additions}
              </span>
            )}
            {item.deletions > 0 && (
              <span className="text-red-600 dark:text-red-400" title="Deletions" data-testid="diff-stat-del">
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
        <p className={diffBinaryNoteClass}>Binary file (diff not shown)</p>
      </div>
    );
  }

  if (item.kind === "no-changes-note") {
    return (
      <div className={sectionClass}>
        <p className={diffBinaryNoteClass}>No textual changes in diff output</p>
      </div>
    );
  }

  if (item.kind === "hunk-header") {
    return (
      <div className={sectionClass}>
        <div className={diffHunkHeaderClass}>{item.text}</div>
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
    return <div className={diffHunkHeaderClass}>{row.text}</div>;
  }
  const lineClass = cn(
    "grid grid-cols-[3.25rem_3.25rem_minmax(0,1fr)] items-stretch font-mono text-[12px] leading-snug",
    row.kind === "add" && "bg-emerald-500/10 dark:bg-emerald-500/15",
    row.kind === "del" && "bg-red-500/10 dark:bg-red-500/15",
    row.kind === "meta" && "bg-card italic text-muted-foreground",
    row.kind === "context" && "bg-transparent",
  );
  return (
    <div className={lineClass} data-testid="diff-line">
      <span className={diffLineNumClass}>{row.oldNum ?? ""}</span>
      <span className={diffLineNumClass}>{row.newNum ?? ""}</span>
      <span className={diffLineContentClass}>{row.text}</span>
    </div>
  );
}

function SplitRowView({ row }: { row: SplitRow }) {
  if (row.kind === "hunk-header") {
    return <div className={diffHunkHeaderClass}>{row.hunkText}</div>;
  }
  if (row.kind === "meta") {
    return (
      <div className="bg-card px-2 py-1 text-center text-[12px] italic text-muted-foreground">
        <span>{row.metaText}</span>
      </div>
    );
  }
  // Remaining rows are `pair`; buildSplitRows always sets both sides. (hunk-header/meta return above.)
  const left = row.left;
  const right = row.right;
  if (left === undefined || right === undefined) {
    return null;
  }
  const rowClass =
    "grid grid-cols-[2.75rem_minmax(0,1fr)_6px_2.75rem_minmax(0,1fr)] items-stretch font-mono text-[12px] leading-snug";

  return (
    <div className={rowClass} data-testid="diff-split-line">
      <span
        className={cn(
          diffLineNumClass,
          left.type === "del" && "text-red-600 dark:text-red-400",
          left.type === "empty" && "text-muted-foreground/50",
        )}
      >
        {left.num}
      </span>
      <span
        className={cn(
          diffLineContentClass,
          "border-r border-border/60",
          left.type === "del" && "bg-red-500/10 dark:bg-red-500/15",
          left.type === "empty" && "bg-muted/40 text-muted-foreground/40",
        )}
      >
        {left.text}
      </span>
      <span className="min-h-full bg-border/80" aria-hidden />
      <span
        className={cn(
          diffLineNumClass,
          right.type === "add" && "text-emerald-600 dark:text-emerald-400",
          right.type === "empty" && "text-muted-foreground/50",
        )}
      >
        {right.num}
      </span>
      <span
        className={cn(
          diffLineContentClass,
          right.type === "add" && "bg-emerald-500/10 dark:bg-emerald-500/15",
          right.type === "empty" && "bg-muted/40 text-muted-foreground/40",
        )}
      >
        {right.text}
      </span>
    </div>
  );
}
