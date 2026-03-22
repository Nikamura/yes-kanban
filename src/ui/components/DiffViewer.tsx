import { useState, useMemo, useEffect, useRef } from "react";
import { DiffEditor, Editor } from "@monaco-editor/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildTree, filterTree, type TreeNode } from "./fileTree";

const BASE_EDITOR_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  lineHeight: 18,
  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
  contextmenu: false,
  automaticLayout: true,
} as const;

interface WorktreeEntry {
  repoId: string;
  repoPath: string;
  baseBranch: string;
  branchName: string;
  worktreePath: string;
}

interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  original: string;
  modified: string;
}

interface DiffViewerProps {
  worktrees: WorktreeEntry[];
  diffOutput?: string;
  fileTree?: string;
  workspaceId?: string;
}

export function DiffViewer({ worktrees, diffOutput, fileTree, workspaceId }: DiffViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"side-by-side" | "inline">("side-by-side");
  const [browseMode, setBrowseMode] = useState<"changes" | "all">("changes");
  const [searchQuery, setSearchQuery] = useState("");

  const files = useMemo(() => (diffOutput ? parseDiffToFiles(diffOutput) : []), [diffOutput]);
  const changedPaths = useMemo(() => new Set(files.map((f) => f.path)), [files]);

  // Parse file tree from JSON string
  const allPaths = useMemo(() => {
    if (!fileTree) return [];
    try {
      return JSON.parse(fileTree) as string[];
    } catch {
      return [];
    }
  }, [fileTree]);

  // Build tree structure from flat paths
  const treeRoot = useMemo(() => {
    const paths = browseMode === "all" ? allPaths : files.map((f) => f.path);
    const changeMap = new Map(files.map((f) => [f.path, f.status]));
    return buildTree(paths, changeMap);
  }, [browseMode, allPaths, files]);

  // Filter tree by search query
  const filteredTree = useMemo(() => {
    if (!searchQuery) return treeRoot;
    const q = searchQuery.toLowerCase();
    return filterTree(treeRoot, q);
  }, [treeRoot, searchQuery]);

  // Determine selected file
  const selectedFile = useMemo(() => {
    if (!selectedPath) return files[0] ?? null;
    return files.find((f) => f.path === selectedPath) ?? null;
  }, [selectedPath, files]);

  const isChangedFile = selectedPath ? changedPaths.has(selectedPath) : true;
  const hasWorktrees = worktrees.length > 0;
  const canBrowseAll = !!fileTree && hasWorktrees;

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
                <code>git diff {wt.baseBranch}..{wt.branchName}</code>
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (files.length === 0 && browseMode === "changes") {
    return (
      <div className="diff-viewer">
        <div className="diff-placeholder">
          <p>No file changes detected.</p>
          {canBrowseAll && (
            <button className="btn btn-sm" onClick={() => setBrowseMode("all")}>
              Browse all files
            </button>
          )}
        </div>
      </div>
    );
  }

  const displayPath = selectedPath ?? selectedFile?.path ?? "";
  const language = guessLanguage(displayPath);

  return (
    <div className="diff-viewer-monaco">
      <div className="diff-file-list">
        <div className="diff-file-list-header">
          <div className="diff-browse-toggle">
            <button
              className={`btn btn-sm ${browseMode === "changes" ? "active" : ""}`}
              onClick={() => { setBrowseMode("changes"); setSearchQuery(""); }}
            >
              Changed ({files.length})
            </button>
            <button
              className={`btn btn-sm ${browseMode === "all" ? "active" : ""}`}
              onClick={() => setBrowseMode("all")}
              disabled={!canBrowseAll}
              title={!canBrowseAll ? "File tree not available" : "Browse all repository files"}
            >
              All Files
            </button>
          </div>
          <div className="diff-view-toggle">
            <button
              className={`btn btn-sm ${viewMode === "side-by-side" ? "active" : ""}`}
              onClick={() => setViewMode("side-by-side")}
              title="Side by side"
            >
              ⬜⬜
            </button>
            <button
              className={`btn btn-sm ${viewMode === "inline" ? "active" : ""}`}
              onClick={() => setViewMode("inline")}
              title="Inline"
            >
              ⬜
            </button>
          </div>
        </div>
        {browseMode === "all" && (
          <div className="diff-search-bar">
            <input
              type="text"
              className="diff-search-input"
              placeholder="Filter files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}
        <div className="diff-file-tree">
          {browseMode === "changes" ? (
            files.map((file) => (
              <button
                key={file.path}
                className={`diff-file-item ${(selectedPath ?? files[0]?.path) === file.path ? "active" : ""}`}
                onClick={() => setSelectedPath(file.path)}
              >
                <span className={`diff-file-status diff-file-${file.status}`}>
                  {file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"}
                </span>
                <span className="diff-file-name" title={file.path}>
                  {file.path.split("/").pop()}
                </span>
                <span className="diff-file-path" title={file.path}>
                  {file.path.includes("/") ? file.path.substring(0, file.path.lastIndexOf("/")) : ""}
                </span>
              </button>
            ))
          ) : (
            filteredTree.map((node) => (
              <TreeNodeView
                key={node.path}
                node={node}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                depth={0}
                defaultExpanded={!!searchQuery}
              />
            ))
          )}
        </div>
      </div>
      <div className="diff-editor-container">
        <div className="diff-editor-header">
          {isChangedFile && selectedFile ? (
            <span className={`diff-file-status diff-file-${selectedFile.status}`}>
              {selectedFile.status === "added" ? "Added" : selectedFile.status === "deleted" ? "Deleted" : "Modified"}
            </span>
          ) : (
            <span className="diff-file-status">Unchanged</span>
          )}
          <span className="diff-editor-path">{displayPath}</span>
        </div>
        {isChangedFile && selectedFile ? (
          <DiffEditor
            key={`${selectedFile.path}-${viewMode}`}
            original={selectedFile.original}
            modified={selectedFile.modified}
            language={language}
            theme="vs-dark"
            options={{
              ...BASE_EDITOR_OPTIONS,
              renderSideBySide: viewMode === "side-by-side",
              renderOverviewRuler: false,
            }}
          />
        ) : selectedPath && workspaceId ? (
          <FileContentViewer
            workspaceId={workspaceId as Id<"workspaces">}
            filePath={selectedPath}
            language={language}
          />
        ) : (
          <div className="diff-placeholder">
            <p>Select a file to view</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FileContentViewer({
  workspaceId,
  filePath,
  language,
}: {
  workspaceId: Id<"workspaces">;
  filePath: string;
  language: string;
}) {
  const fileContent = useQuery(api.fileContentRequests.getByPath, {
    workspaceId,
    filePath,
  });
  const createRequest = useMutation(api.fileContentRequests.create);
  const requestedPath = useRef<string | null>(null);

  useEffect(() => {
    if (fileContent === null && requestedPath.current !== filePath) {
      requestedPath.current = filePath;
      void createRequest({ workspaceId, filePath });
    }
  }, [fileContent, workspaceId, filePath, createRequest]);

  if (fileContent === undefined || fileContent === null || fileContent.status === "pending") {
    return (
      <div className="diff-placeholder">
        <div className="diff-loading-spinner" />
        <p>Loading file content...</p>
      </div>
    );
  }

  if (fileContent.status === "error") {
    return (
      <div className="diff-placeholder">
        <p className="diff-error-text">{fileContent.error ?? "Failed to load file"}</p>
      </div>
    );
  }

  if (fileContent.isBinary) {
    return (
      <div className="diff-placeholder">
        <p>Binary file ({fileContent.fileSize ? `${Math.round(fileContent.fileSize / 1024)}KB` : "unknown size"})</p>
      </div>
    );
  }

  return (
    <Editor
      key={filePath}
      value={fileContent.content ?? ""}
      language={language}
      theme="vs-dark"
      options={BASE_EDITOR_OPTIONS}
    />
  );
}

function TreeNodeView({
  node,
  selectedPath,
  onSelect,
  depth,
  defaultExpanded,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 1 || defaultExpanded);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync expanded with prop changes
  useEffect(() => { setExpanded(defaultExpanded || depth < 1); }, [defaultExpanded, depth]);

  if (!node.isDir) {
    return (
      <button
        className={`diff-file-item diff-tree-file ${selectedPath === node.path ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.path)}
      >
        {node.changeStatus && (
          <span className={`diff-file-status diff-file-${node.changeStatus}`}>
            {node.changeStatus === "added" ? "A" : node.changeStatus === "deleted" ? "D" : "M"}
          </span>
        )}
        <span className="diff-file-name" title={node.path}>
          {node.name}
        </span>
      </button>
    );
  }

  return (
    <div className="diff-tree-dir">
      <button
        className="diff-tree-dir-header"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="diff-tree-chevron">{expanded ? "▼" : "▶"}</span>
        <span className="diff-tree-dir-name">{node.name}</span>
      </button>
      {expanded && node.children.map((child) => (
        <TreeNodeView
          key={child.path}
          node={child}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth + 1}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </div>
  );
}

/**
 * Parse a unified diff into file objects with original and modified content,
 * suitable for Monaco's DiffEditor.
 */
function parseDiffToFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const rawFiles = splitDiffByFile(diff);

  for (const raw of rawFiles) {
    const originalLines: string[] = [];
    const modifiedLines: string[] = [];

    for (const hunk of raw.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+")) {
          modifiedLines.push(line.slice(1));
        } else if (line.startsWith("-")) {
          originalLines.push(line.slice(1));
        } else if (line.startsWith(" ")) {
          originalLines.push(line.slice(1));
          modifiedLines.push(line.slice(1));
        }
      }
    }

    files.push({
      path: raw.path,
      status: raw.status,
      original: originalLines.join("\n"),
      modified: modifiedLines.join("\n"),
    });
  }

  return files;
}

interface RawDiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  hunks: { header: string; lines: string[] }[];
}

function splitDiffByFile(diff: string): RawDiffFile[] {
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
      };
      currentHunk = null;
    } else if (line.startsWith("new file")) {
      if (currentFile) currentFile.status = "added";
    } else if (line.startsWith("deleted file")) {
      if (currentFile) currentFile.status = "deleted";
    } else if (line.startsWith("@@")) {
      currentHunk = { header: line, lines: [] };
      if (currentFile) currentFile.hunks.push(currentHunk);
    } else if (currentHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      currentHunk.lines.push(line);
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", css: "css", scss: "scss", less: "less",
  html: "html", xml: "xml", yaml: "yaml", yml: "yaml", toml: "toml",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  sh: "shell", bash: "shell", zsh: "shell", sql: "sql",
  graphql: "graphql", gql: "graphql", svelte: "html", vue: "html",
};

function guessLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "plaintext";
}
