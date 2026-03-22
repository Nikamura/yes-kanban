import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useEffect, useRef, useState, useMemo } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolUseLine, ToolResultLine } from "./ToolRenderers";

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
    case "claude-code": return "Claude";
    case "cursor": return "Cursor";
    case "codex": return "Codex";
    case "pi": return "Pi";
    default: return agentType ?? "Agent";
  }
}

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

  if (!logs) return <div className="loading">Loading logs...</div>;
  if (logs.length === 0) return <div className="empty-state">No output yet</div>;

  return (
    <div className="log-stream" ref={containerRef} onScroll={handleScroll}>
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
    <div className="log-line log-prompt">
      <span className="log-badge log-badge-prompt">Prompt</span>
      <div className="log-prompt-content">
        <div
          className={isLong ? "log-expandable" : ""}
          onClick={() => isLong && setExpanded(!expanded)}
        >
          <div className="log-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {expanded || !isLong ? prompt : prompt.slice(0, 300) + "…"}
            </ReactMarkdown>
          </div>
          {isLong && <span className="log-expand-icon">{expanded ? "▾" : "▸"}</span>}
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
]);

/** System subtypes that are noisy and should be hidden */
const SKIP_SYSTEM_SUBTYPES = new Set([
  "task_started",
  "task_progress",
  "task_completed",
]);

function LogLine({ log, toolIdMap, agentType }: { log: any; toolIdMap: Map<string, string>; agentType?: string }) {
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
          <div className="log-line log-mcp">
            <span className="log-badge log-badge-mcp">MCP</span>
            <span className="log-tool-name">{event.data?.tool ?? event.tool}</span>
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

  return (
    <div className={`log-line log-${log.stream}`}>
      <span className="log-text">{log.line}</span>
    </div>
  );
}

// --- Assistant ---

/** Render links as plain text — agent output contains local file paths that shouldn't be clickable */
const noLinkComponents = {
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
};

function AssistantLine({ data, agentType }: { data: any; agentType?: string }) {
  const text = extractContent(data);
  if (!text) return null;

  return (
    <div className="log-line log-assistant">
      <span className="log-badge log-badge-assistant">{agentLabel(agentType)}</span>
      <div className="log-assistant-content log-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={noLinkComponents}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

// --- System ---

/** Codex system event types that are lifecycle noise and should be hidden */
const SKIP_CODEX_SYSTEM_TYPES = new Set([
  "thread.started",
  "turn.started",
]);

function SystemLine({ data }: { data: any }) {
  if (!data) return null;
  const subtype = data.subtype;

  if (SKIP_SYSTEM_SUBTYPES.has(subtype)) return null;
  if (subtype === "hook_started") return null;
  // Codex uses data.type instead of data.subtype for system events
  if (SKIP_CODEX_SYSTEM_TYPES.has(data.type)) return null;

  if (subtype === "init") {
    return (
      <div className="log-line log-system">
        <span className="log-badge log-badge-system">System</span>
        <span className="log-text">
          Session started — model: {data.model ?? "unknown"}, mode: {data.permissionMode ?? "unknown"}
        </span>
      </div>
    );
  }

  if (subtype === "hook_response") {
    return <HookResponseLine data={data} />;
  }

  return (
    <div className="log-line log-system log-muted">
      <span className="log-badge log-badge-system">System</span>
      <span className="log-text">{subtype ?? "event"}</span>
    </div>
  );
}

function HookResponseLine({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const success = data.exit_code === 0;
  const output = data.stdout?.trim();
  const isLong = output && output.length > 80;

  return (
    <div className={`log-line log-system ${success ? "" : "log-error"}`}>
      <span className="log-badge log-badge-system">Hook</span>
      <div className="log-tool-content">
        <span
          className={isLong ? "log-text log-expandable" : "log-text"}
          onClick={() => isLong && setExpanded(!expanded)}
        >
          {data.hook_name}: {success ? "✓" : `✗ exit ${data.exit_code}`}
          {output && !expanded && (
            <span className="log-hook-output"> — {truncate(output, 80)}</span>
          )}
          {isLong && <span className="log-expand-icon">{expanded ? "▾" : "▸"}</span>}
        </span>
        {expanded && output && (
          <pre className="log-tool-input">{output}</pre>
        )}
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
    <div className="log-tool-card log-permission-request">
      <div className="log-tool-card-header">
        <span className="log-badge log-badge-permission">Permission</span>
        <span className="log-tool-name">{toolName}</span>
      </div>
      {inputStr && (
        <pre className="log-tool-input">{truncate(inputStr, 300)}</pre>
      )}
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
    <div className="log-line log-completion">
      <span className="log-badge log-badge-completion">Done</span>
      <div className="log-completion-content">
        {stats.length > 0 && (
          <span className="log-completion-stats">{stats.join(" · ")}</span>
        )}
        {result && (
          <div className="log-completion-result log-markdown">
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
    <div className="log-line log-error">
      <span className="log-badge log-badge-error">Error</span>
      <span className="log-text">{typeof message === "string" ? message : line}</span>
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
  if (!line.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(line);
    return SKIP_JSON_TYPES.has(parsed.type);
  } catch {
    return false;
  }
}
