import { useState } from "react";

// --- Shared helpers (also used by LogStream) ---

export function shortenPath(fullPath: string): string {
  const parts = fullPath.split("/");
  if (parts.length <= 3) return fullPath;
  return "…/" + parts.slice(-3).join("/");
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// --- Private helpers ---

function formatInput(input: any): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function formatLineRange(offset?: number, limit?: number): string | null {
  if (offset === undefined && limit === undefined) return null;
  if (offset !== undefined && limit !== undefined) return `lines ${offset}–${offset + limit}`;
  if (offset !== undefined) return `from line ${offset}`;
  if (limit !== undefined) return `${limit} lines`;
  return null;
}

function extractToolResultText(data: any): string | null {
  if (!data) return null;
  if (typeof data.content === "string") return data.content;
  if (typeof data.output === "string") return data.output;
  if (Array.isArray(data.content)) {
    const text = data.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return text || null; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string should be null
  }
  return null;
}

/** Normalize tool names from different agents to canonical form */
const TOOL_NAME_ALIASES: Record<string, string> = {
  edit_file: "Edit",
  read_file: "Read",
  write_file: "Write",
  create_file: "Write",
  list_files: "Glob",
  search_files: "Grep",
  run_terminal_command: "Bash",
  execute_command: "Bash",
  file_search: "Grep",
  codebase_search: "Grep",
  // Cursor lowercase variants (from pre-fix stored events)
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
  read: "Read",
  write: "Write",
  bash: "Bash",
};

// --- Tool Use (dispatcher) ---

export function ToolUseLine({ data }: { data: any }) {
  const rawName = data?.name ?? "unknown";
  const name = TOOL_NAME_ALIASES[rawName] ?? rawName;
  switch (name) {
    case "Bash":
      return <BashToolLine data={data} />;
    case "Read":
      return <ReadToolLine data={data} />;
    case "Edit":
      return <EditToolLine data={data} />;
    case "Write":
      return <WriteToolLine data={data} />;
    case "Grep":
      return <GrepToolLine data={data} />;
    case "Glob":
      return <GlobToolLine data={data} />;
    case "Agent":
      return <AgentToolLine data={data} />;
    case "Skill":
      return <SkillToolLine data={data} />;
    case "TodoWrite":
      return <TodoWriteToolLine data={data} />;
    case "WebFetch":
      return <WebFetchToolLine data={data} />;
    case "WebSearch":
      return <WebSearchToolLine data={data} />;
    case "LSP":
      return <LSPToolLine data={data} />;
    case "NotebookEdit":
      return <NotebookEditToolLine data={data} />;
    default:
      return <GenericToolLine data={data} />;
  }
}

// --- Individual Tool Renderers ---

function BashToolLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const input = data?.input;
  const command = input?.command ?? "";
  const description = input?.description;

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">$</span>
        {description && <span className="log-bash-desc">{description}</span>}
        {!description && command && <span className="log-bash-desc">{truncate(command, 80)}</span>}
        <button className="log-expandable log-expand-icon" onClick={() => setExpanded(!expanded)}>
          {expanded ? "▾" : "▸"}
        </button>
      </div>
      {expanded && <pre className="log-bash-command">{command}</pre>}
    </div>
  );
}

function ReadToolLine({ data }: { data: any }) {
  const input = data?.input;
  const filePath = input?.file_path ?? "unknown";
  const range = formatLineRange(input?.offset, input?.limit);

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Read</span>
        <span className="log-tool-filepath">{shortenPath(filePath)}</span>
        {range && <span className="log-tool-meta">{range}</span>}
      </div>
    </div>
  );
}

function EditToolLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const input = data?.input;
  const filePath = input?.file_path ?? "unknown";
  const oldStr: string = input?.old_string ?? "";
  const newStr: string = input?.new_string ?? "";
  const hasDiff = oldStr.length > 0 || newStr.length > 0;

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Edit</span>
        <span className="log-tool-filepath">{shortenPath(filePath)}</span>
        {hasDiff && (
          <button className="log-expandable log-expand-icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {hasDiff && expanded && (
        <div className="log-diff">
          {oldStr && <pre className="log-diff-old">{oldStr}</pre>}
          {newStr && <pre className="log-diff-new">{newStr}</pre>}
        </div>
      )}
    </div>
  );
}

function WriteToolLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const input = data?.input;
  const filePath = input?.file_path ?? "unknown";
  const content = input?.content ?? "";
  const lines = content.split("\n");

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Write</span>
        <span className="log-tool-filepath">{shortenPath(filePath)}</span>
        <span className="log-tool-meta">{lines.length} lines</span>
        {content && (
          <button className="log-expandable log-expand-icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {expanded && content && (
        <pre className="log-tool-input">{content}</pre>
      )}
    </div>
  );
}

function GrepToolLine({ data }: { data: any }) {
  const input = data?.input;
  const pattern = input?.pattern ?? "";
  const path = input?.path;
  const glob = input?.glob;

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Grep</span>
        <code className="log-tool-pattern">{pattern}</code>
        {path && <span className="log-tool-meta">in {shortenPath(path)}</span>}
        {glob && <span className="log-tool-meta">({glob})</span>}
      </div>
    </div>
  );
}

function GlobToolLine({ data }: { data: any }) {
  const input = data?.input;
  const pattern = input?.pattern ?? "";
  const path = input?.path;

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Glob</span>
        <code className="log-tool-pattern">{pattern}</code>
        {path && <span className="log-tool-meta">in {shortenPath(path)}</span>}
      </div>
    </div>
  );
}

function AgentToolLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const input = data?.input;
  const prompt = input?.prompt ?? "";
  const desc = input?.description ?? "";

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Agent</span>
        {desc && <span className="log-tool-meta">{desc}</span>}
        {prompt && (
          <button className="log-expandable log-expand-icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {expanded && prompt && (
        <div className="log-text">{prompt}</div>
      )}
    </div>
  );
}

function SkillToolLine({ data }: { data: any }) {
  const input = data?.input;
  const skill = input?.skill ?? "unknown";
  const args = input?.args;

  return (
    <div className="log-tool-card log-tool-card-skill">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-skill">Skill</span>
        <span className="log-tool-name">{skill}</span>
        {args && <span className="log-tool-meta">{args}</span>}
      </div>
    </div>
  );
}

function TodoWriteToolLine({ data }: { data: any }) {
  const input = data?.input;
  const todos: any[] = Array.isArray(input?.todos) ? input.todos : [];
  const completed = todos.filter((t: any) => t.status === "completed").length;
  const inProgress = todos.filter((t: any) => t.status === "in_progress").length;
  const pending = todos.filter((t: any) => t.status === "pending").length;

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Tasks</span>
        <span className="log-tool-meta">
          {completed > 0 && <span className="log-todo-done">{completed} done</span>}
          {inProgress > 0 && <span className="log-todo-active">{inProgress} active</span>}
          {pending > 0 && <span className="log-todo-pending">{pending} pending</span>}
        </span>
      </div>
      {todos.length > 0 && (
        <div className="log-todo-list">
          {todos.map((t: any, i: number) => (
            <div key={i} className={`log-todo-item log-todo-${t.status}`}>
              <span className="log-todo-icon">
                {t.status === "completed" ? "✓" : t.status === "in_progress" ? "→" : "○"}
              </span>
              <span>{t.status === "in_progress" ? (t.activeForm ?? t.content) : t.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebFetchToolLine({ data }: { data: any }) {
  const input = data?.input;
  const url = input?.url ?? "unknown";

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Fetch</span>
        <span className="log-tool-filepath">{url}</span>
      </div>
    </div>
  );
}

function WebSearchToolLine({ data }: { data: any }) {
  const input = data?.input;
  const query = input?.query ?? "";

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Search</span>
        <code className="log-tool-pattern">{query}</code>
      </div>
    </div>
  );
}

function LSPToolLine({ data }: { data: any }) {
  const input = data?.input;
  const action = input?.action ?? "unknown";
  const filePath = input?.file_path;
  const symbol = input?.symbol;

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">LSP</span>
        <span className="log-tool-name">{action}</span>
        {symbol && <code className="log-tool-pattern">{symbol}</code>}
        {filePath && <span className="log-tool-filepath">{shortenPath(filePath)}</span>}
      </div>
    </div>
  );
}

function NotebookEditToolLine({ data }: { data: any }) {
  const input = data?.input;
  const notebook = input?.notebook ?? input?.file_path ?? "unknown";
  const command = input?.command ?? "edit";

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">Notebook</span>
        <span className="log-tool-name">{command}</span>
        <span className="log-tool-filepath">{shortenPath(notebook)}</span>
      </div>
    </div>
  );
}

function GenericToolLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const name = data?.name ?? "unknown";
  const input = data?.input;

  return (
    <div className="log-tool-card">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-tool">{name}</span>
        {input && (
          <button className="log-expandable log-expand-icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {expanded && input && (
        <pre className="log-tool-input">{formatInput(input)}</pre>
      )}
    </div>
  );
}

// --- Tool Result ---

export function ToolResultLine({ data, line, toolIdMap }: { data: any; line: string; toolIdMap: Map<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const content = extractToolResultText(data) ?? line;
  const toolUseId = data?.tool_use_id;
  const toolName = toolUseId ? toolIdMap.get(toolUseId) : undefined;
  const contentLines = content.split("\n");
  const summary = toolName ? buildResultSummary(toolName, content) : null;
  const fallbackSummary = summary ?? `${contentLines.length} line${contentLines.length !== 1 ? "s" : ""}`;
  const isShort = contentLines.length === 1 && content.length <= 120;

  return (
    <div className="log-result-block">
      <div
        className={`log-result-header ${isShort ? "" : "log-expandable"}`}
        onClick={() => !isShort && setExpanded(!expanded)}
      >
        {toolName && <span className="log-badge log-badge-result">{toolName}</span>}
        <span className="log-result-summary">
          {isShort ? content : fallbackSummary}
        </span>
        {!isShort && <span className="log-expand-icon">{expanded ? "▾" : "▸"}</span>}
      </div>
      {expanded && (
        <pre className="log-result-pre">{content}</pre>
      )}
    </div>
  );
}

function buildResultSummary(toolName: string, content: string): string | null {
  const lines = content.split("\n").filter(Boolean);
  switch (toolName) {
    case "Grep":
    case "Glob": {
      const fileCount = lines.length;
      if (fileCount > 0) return `${fileCount} result${fileCount !== 1 ? "s" : ""}`;
      return "no results";
    }
    case "Read": {
      return `${lines.length} line${lines.length !== 1 ? "s" : ""} read`;
    }
    case "Bash": {
      if (content.trim() === "") return "no output";
      return `${lines.length} line${lines.length !== 1 ? "s" : ""} output`;
    }
    default:
      return null;
  }
}
