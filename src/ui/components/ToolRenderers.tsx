import { useState } from "react";
import { Badge } from "@/ui/components/ui/badge";
import { cn } from "@/ui/lib/utils";
import {
  logBadgeClasses,
  logBashCommandPreClass,
  logDiffNewPreClass,
  logDiffOldPreClass,
  logDiffWrapClass,
  logExpandToggleClass,
  logResultBlockClass,
  logResultHeaderClass,
  logResultPreClass,
  logTodoCountClass,
  logTodoItemClass,
  logToolCardHeaderClass,
  logToolCardClass,
  logToolCardSkillClass,
  logToolInputPreClass,
} from "@/ui/lib/logUi";

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

const toolBadge = (
  <Badge className={cn("font-mono text-[10px]", logBadgeClasses.tool)}>$</Badge>
);

const toolBadgeLabel = (label: string) => (
  <Badge className={cn("font-mono text-[10px]", logBadgeClasses.tool)}>{label}</Badge>
);

// --- Individual Tool Renderers ---

function BashToolLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const input = data?.input;
  const command = input?.command ?? "";
  const description = input?.description;

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadge}
        {description && <span className="text-foreground">{description}</span>}
        {!description && command && <span className="text-foreground">{truncate(command, 80)}</span>}
        <button type="button" className={logExpandToggleClass} onClick={() => setExpanded(!expanded)}>
          {expanded ? "▾" : "▸"}
        </button>
      </div>
      {expanded && <pre className={logBashCommandPreClass}>{command}</pre>}
    </div>
  );
}

function ReadToolLine({ data }: { data: any }) {
  const input = data?.input;
  const filePath = input?.file_path ?? "unknown";
  const range = formatLineRange(input?.offset, input?.limit);

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Read")}
        <span className="text-violet-700 dark:text-violet-300">{shortenPath(filePath)}</span>
        {range && <span className="text-muted-foreground">{range}</span>}
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
  const linesAdded = input?.lines_added;
  const linesRemoved = input?.lines_removed;
  const addedNum = typeof linesAdded === "number" ? linesAdded : undefined;
  const removedNum = typeof linesRemoved === "number" ? linesRemoved : undefined;
  const lineCountMeta =
    hasDiff && (addedNum !== undefined || removedNum !== undefined)
      ? [addedNum !== undefined ? `+${addedNum}` : null, removedNum !== undefined ? `-${removedNum}` : null]
          .filter(Boolean)
          .join(" / ")
      : null;

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Edit")}
        <span className="text-violet-700 dark:text-violet-300">{shortenPath(filePath)}</span>
        {lineCountMeta && <span className="text-muted-foreground">{lineCountMeta}</span>}
        {hasDiff && (
          <button type="button" className={logExpandToggleClass} onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {hasDiff && expanded && (
        <div className={logDiffWrapClass}>
          {oldStr && <pre className={logDiffOldPreClass}>{oldStr}</pre>}
          {newStr && <pre className={logDiffNewPreClass}>{newStr}</pre>}
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
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Write")}
        <span className="text-violet-700 dark:text-violet-300">{shortenPath(filePath)}</span>
        <span className="text-muted-foreground">{lines.length} lines</span>
        {content && (
          <button type="button" className={logExpandToggleClass} onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {expanded && content && <pre className={logToolInputPreClass}>{content}</pre>}
    </div>
  );
}

function GrepToolLine({ data }: { data: any }) {
  const input = data?.input;
  const pattern = input?.pattern ?? "";
  const path = input?.path;
  const glob = input?.glob;

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Grep")}
        <code className="rounded bg-muted px-1 text-[11px] text-foreground">{pattern}</code>
        {path && <span className="text-muted-foreground">in {shortenPath(path)}</span>}
        {glob && <span className="text-muted-foreground">({glob})</span>}
      </div>
    </div>
  );
}

function GlobToolLine({ data }: { data: any }) {
  const input = data?.input;
  const pattern = input?.pattern ?? "";
  const path = input?.path;

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Glob")}
        <code className="rounded bg-muted px-1 text-[11px] text-foreground">{pattern}</code>
        {path && <span className="text-muted-foreground">in {shortenPath(path)}</span>}
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
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Agent")}
        {desc && <span className="text-muted-foreground">{desc}</span>}
        {prompt && (
          <button type="button" className={logExpandToggleClass} onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {expanded && prompt && <div className="whitespace-pre-wrap break-words text-foreground">{prompt}</div>}
    </div>
  );
}

function SkillToolLine({ data }: { data: any }) {
  const input = data?.input;
  const skill = input?.skill ?? "unknown";
  const args = input?.args;

  return (
    <div className={logToolCardSkillClass}>
      <div className={logToolCardHeaderClass}>
        <Badge className={cn("font-mono text-[10px]", logBadgeClasses.skill)}>Skill</Badge>
        <span className="font-medium text-foreground">{skill}</span>
        {args && <span className="text-muted-foreground">{args}</span>}
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
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Tasks")}
        <span className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          {completed > 0 && <span className={logTodoCountClass("done")}>{completed} done</span>}
          {inProgress > 0 && <span className={logTodoCountClass("active")}>{inProgress} active</span>}
          {pending > 0 && <span className={logTodoCountClass("pending")}>{pending} pending</span>}
        </span>
      </div>
      {todos.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {todos.map((t: any, i: number) => (
            <div key={i} className={logTodoItemClass(t.status)}>
              <span className="w-3 shrink-0 text-center">
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
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Fetch")}
        <span className="break-all text-violet-700 dark:text-violet-300">{url}</span>
      </div>
    </div>
  );
}

function WebSearchToolLine({ data }: { data: any }) {
  const input = data?.input;
  const query = input?.query ?? "";

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Search")}
        <code className="rounded bg-muted px-1 text-[11px] text-foreground">{query}</code>
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
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("LSP")}
        <span className="font-medium">{action}</span>
        {symbol && <code className="rounded bg-muted px-1 text-[11px]">{symbol}</code>}
        {filePath && <span className="text-violet-700 dark:text-violet-300">{shortenPath(filePath)}</span>}
      </div>
    </div>
  );
}

function NotebookEditToolLine({ data }: { data: any }) {
  const input = data?.input;
  const notebook = input?.notebook ?? input?.file_path ?? "unknown";
  const command = input?.command ?? "edit";

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        {toolBadgeLabel("Notebook")}
        <span className="font-medium">{command}</span>
        <span className="text-violet-700 dark:text-violet-300">{shortenPath(notebook)}</span>
      </div>
    </div>
  );
}

function GenericToolLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const name = data?.name ?? "unknown";
  const input = data?.input;

  return (
    <div className={logToolCardClass}>
      <div className={logToolCardHeaderClass}>
        <Badge className={cn("font-mono text-[10px]", logBadgeClasses.tool)}>{name}</Badge>
        {input && (
          <button type="button" className={logExpandToggleClass} onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {expanded && input && <pre className={logToolInputPreClass}>{formatInput(input)}</pre>}
    </div>
  );
}

// --- Tool Result ---

export function ToolResultLine({
  data,
  line,
  toolIdMap,
}: {
  data: any;
  line: string;
  toolIdMap: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = extractToolResultText(data) ?? line;
  const toolUseId = data?.tool_use_id;
  const toolName = toolUseId ? toolIdMap.get(toolUseId) : undefined;
  const contentLines = content.split("\n");
  const summary = toolName ? buildResultSummary(toolName, content) : null;
  const fallbackSummary = summary ?? `${contentLines.length} line${contentLines.length !== 1 ? "s" : ""}`;
  const isShort = contentLines.length === 1 && content.length <= 120;

  return (
    <div className={logResultBlockClass}>
      <div
        className={logResultHeaderClass(!isShort)}
        onClick={() => !isShort && setExpanded(!expanded)}
      >
        {toolName && (
          <Badge className={cn("font-mono text-[10px]", logBadgeClasses.result)}>{toolName}</Badge>
        )}
        <span className="min-w-0 flex-1 text-muted-foreground">{isShort ? content : fallbackSummary}</span>
        {!isShort && <span className="text-[10px] text-muted-foreground">{expanded ? "▾" : "▸"}</span>}
      </div>
      {expanded && <pre className={logResultPreClass}>{content}</pre>}
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
