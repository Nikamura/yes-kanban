import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useEffect, useRef, useState, useMemo } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolUseLine, ToolResultLine } from "./ToolRenderers";
import { Badge } from "@/ui/components/ui/badge";
import { cn } from "@/ui/lib/utils";
import {
  logBadgeClasses,
  logCompletionResultWrapClass,
  logCompletionStatsClass,
  logHookOutputClass,
  logLineRootClass,
  logPermissionCardClass,
  logTextMutedClass,
  logToolInputPreClass,
} from "@/ui/lib/logUi";

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

/** Map tool_use_id → tool name so we can label tool results */
function buildToolIdMap(logs: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const log of logs) {
    const event = log.structured;
    if (event?.type === "tool_use") {
      const id = event.data?.tool_use_id;
      const name = event.data?.name;
      if (id && name) map.set(id, name);
    }
  }
  return map;
}

/** Map agentType to a display label for the assistant badge */
function agentLabel(agentType?: string): string {
  switch (agentType) {
    case "claude-code":
      return "Claude";
    case "cursor":
      return "Cursor";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    default:
      return agentType ?? "Agent";
  }
}

const loadingSpinner = (
  <div className="flex items-center gap-2 p-4 text-muted-foreground">
    <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
    <span>Loading logs...</span>
  </div>
);

export function LogStream({
  runAttemptId,
  prompt,
  agentType,
}: {
  runAttemptId: Id<"runAttempts">;
  prompt?: string;
  agentType?: string;
}) {
  const logs = useQuery(api.agentLogs.list, { runAttemptId, limit: 500 });
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const toolIdMap = useMemo(() => buildToolIdMap(logs ?? []), [logs]);

  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  if (!logs) return loadingSpinner;
  if (logs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
        No output yet
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 font-mono text-xs leading-relaxed"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {prompt && <PromptBlock prompt={prompt} />}
      {logs.map((log) => (
        <LogLine key={log._id} log={log} toolIdMap={toolIdMap} agentType={agentType} />
      ))}
    </div>
  );
}

function PromptBlock({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = prompt.length > 300;

  return (
    <div className={logLineRootClass("prompt")}>
      <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.prompt)}>Prompt</Badge>
      <div className="min-w-0 flex-1">
        <div
          className={cn(isLong && "cursor-pointer")}
          onClick={() => isLong && setExpanded(!expanded)}
        >
          <div className="prose-log text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {expanded || !isLong ? prompt : prompt.slice(0, 300) + "…"}
            </ReactMarkdown>
          </div>
          {isLong && (
            <span className="ml-1 inline text-[10px] text-muted-foreground">
              {expanded ? "▾" : "▸"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Noisy JSON event types to skip when they appear as unstructured lines */
const SKIP_JSON_TYPES = new Set([
  "rate_limit_event",
  "content_block_delta",
  "content_block_start",
  "content_block_stop",
  "step_start",
  "step_finish",
  "text",
  "tool_use",
]);

/** System subtypes that are noisy and should be hidden */
const SKIP_SYSTEM_SUBTYPES = new Set(["task_started", "task_progress", "task_completed"]);

function LogLine({
  log,
  toolIdMap,
  agentType,
}: {
  log: any;
  toolIdMap: Map<string, string>;
  agentType?: string;
}) {
  if (log.structured) {
    const event = log.structured;
    switch (event.type) {
      case "assistant_message":
        return <AssistantLine data={event.data} agentType={agentType} />;
      case "tool_use":
        return <ToolUseLine data={event.data} />;
      case "tool_result":
        return <ToolResultLine data={event.data} line={log.line} toolIdMap={toolIdMap} />;
      case "mcp_tool_call":
        return (
          <div className={logLineRootClass("mcp")}>
            <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.mcp)}>MCP</Badge>
            <span className="font-medium text-foreground">{event.data?.tool ?? event.tool}</span>
          </div>
        );
      case "system":
        return <SystemLine data={event.data} />;
      case "permission_request":
        return <PermissionRequestLine data={event.data} />;
      case "completion":
        return <CompletionLine data={event.data} />;
      case "error":
        return <ErrorLine data={event.data} line={log.line} />;
      case "token_usage":
      case "unknown":
        return null;
    }
  }

  const line = log.line?.trim();
  if (!line) return null;
  if (isNoisyJson(line)) return null;

  const stream = typeof log.stream === "string" ? log.stream : "tool";
  return (
    <div className={logLineRootClass(stream)}>
      <span className="whitespace-pre-wrap break-words">{log.line}</span>
    </div>
  );
}

// --- Assistant ---

/** Render links as plain text — agent output contains local file paths that shouldn't be clickable */
const noLinkComponents = {
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
};

function AssistantLine({ data, agentType }: { data: any; agentType?: string }) {
  const text = extractContent(data)?.trim();
  if (!text) return null;

  return (
    <div className={logLineRootClass("assistant")}>
      <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.assistant)}>
        {agentLabel(agentType)}
      </Badge>
      <div className={cn("min-w-0 flex-1 prose-log text-xs")}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={noLinkComponents}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// --- System ---

/** Codex system event types that are lifecycle noise and should be hidden */
const SKIP_CODEX_SYSTEM_TYPES = new Set(["turn.started"]);

function SystemLine({ data }: { data: any }) {
  if (!data) return null;
  const subtype = data.subtype;

  if (SKIP_SYSTEM_SUBTYPES.has(subtype)) return null;
  if (subtype === "hook_started") return null;
  // Codex uses data.type instead of data.subtype for system events
  if (SKIP_CODEX_SYSTEM_TYPES.has(data.type)) return null;

  if (subtype === "init") {
    return (
      <div className={logLineRootClass("system")}>
        <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.system)}>System</Badge>
        <span className="text-foreground">
          Session started — model: {data.model ?? "unknown"}, mode: {data.permissionMode ?? "unknown"}
        </span>
      </div>
    );
  }

  if (subtype === "hook_response") {
    return <HookResponseLine data={data} />;
  }

  return (
    <div className={cn(logLineRootClass("system"), logTextMutedClass)}>
      <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.system)}>System</Badge>
      <span>{subtype ?? "event"}</span>
    </div>
  );
}

function HookResponseLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const success = data.exit_code === 0;
  const output = data.stdout?.trim();
  const isLong = output && output.length > 80;

  return (
    <div className={logLineRootClass("system", !success ? "text-destructive" : undefined)}>
      <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.system)}>Hook</Badge>
      <div className="min-w-0 flex-1">
        <span
          className={cn(isLong && "cursor-pointer")}
          onClick={() => isLong && setExpanded(!expanded)}
        >
          {data.hook_name}: {success ? "✓" : `✗ exit ${data.exit_code}`}
          {output && !expanded && <span className={logHookOutputClass}> — {truncate(output, 80)}</span>}
          {isLong && <span className="ml-1 text-[10px] text-muted-foreground">{expanded ? "▾" : "▸"}</span>}
        </span>
        {expanded && output && <pre className={logToolInputPreClass}>{output}</pre>}
      </div>
    </div>
  );
}

// --- Permission Request ---

function PermissionRequestLine({ data }: { data: any }) {
  const tool = data?.tool;
  const toolName = tool?.name ?? data?.name ?? "unknown";
  const toolInput = tool?.input ?? data?.input;
  const inputStr = toolInput ? (typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput)) : "";

  return (
    <div className={logPermissionCardClass}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("font-mono text-[10px]", logBadgeClasses.permission)}>Permission</Badge>
        <span className="font-medium">{toolName}</span>
      </div>
      {inputStr && <pre className={logToolInputPreClass}>{truncate(inputStr, 300)}</pre>}
    </div>
  );
}

// --- Completion / Error ---

function CompletionLine({ data }: { data: any }) {
  if (!data) return null;
  const cost = data.total_cost_usd;
  const duration = data.duration_ms;
  const result = data.result;

  const stats = [
    duration !== null && duration !== undefined && `${(duration / 1000).toFixed(1)}s`,
    cost !== null && cost !== undefined && `$${cost.toFixed(4)}`,
    data.num_turns !== null && data.num_turns !== undefined && `${data.num_turns} turn${data.num_turns !== 1 ? "s" : ""}`,
  ].filter(Boolean);

  return (
    <div className={logLineRootClass("completion")}>
      <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.completion)}>Done</Badge>
      <div className="min-w-0 flex-1">
        {stats.length > 0 && <span className={logCompletionStatsClass}>{stats.join(" · ")}</span>}
        {result && (
          <div className={cn(logCompletionResultWrapClass, "prose-log text-xs")}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorLine({ data, line }: { data: any; line: string }) {
  const message = data?.error?.message ?? data?.message ?? extractContent(data) ?? line;
  return (
    <div className={logLineRootClass("error")}>
      <Badge className={cn("shrink-0 font-mono text-[10px]", logBadgeClasses.error)}>Error</Badge>
      <span>{typeof message === "string" ? message : line}</span>
    </div>
  );
}

// --- Helpers ---

function extractContent(data: any): string | null {
  if (!data) return null;
  const msg = data.message ?? data;
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return text || null;
  }
  if (typeof data.message === "string") return data.message;
  return null;
}

function isNoisyJson(line: string): boolean {
  // Strip terminal escape sequences (OSC title-setting) that OpenCode prepends
  // eslint-disable-next-line no-control-regex -- intentional: stripping terminal escape codes
  const cleaned = line.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\]0;[^\x07]*?(?:\x07|(?=\]0;|\{))/g, "")
    .trim();
  if (!cleaned) return true; // pure escape sequences — skip

  const target = cleaned.startsWith("{") ? cleaned : line.startsWith("{") ? line : null;
  if (!target) return false;
  try {
    const parsed = JSON.parse(target);
    if (SKIP_JSON_TYPES.has(parsed.type)) return true;
    // Cursor echoes "user" messages as raw JSON — suppress them
    if (parsed.type === "user") return true;
    return false;
  } catch {
    // If the cleaned version contains JSON-like content after escape sequences, suppress it
    return cleaned.startsWith("{") && cleaned.includes('"type"');
  }
}
