import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useEffect, useCallback, useRef } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/ui/components/ui/button";
import { PromptTemplatesSection } from "./PromptTemplatesSection";
import { IssueTemplatesSection } from "./IssueTemplatesSection";
import { NotificationPrefsSection } from "./NotificationPrefsSection";
import {
  type AgentAdvancedForm,
  parseEnvString,
  envToString,
  parseArgs,
  argsToString,
  parseOptionalStringArray,
  validateAgentAdvanced,
} from "./agentConfigUtils";

const AGENT_TYPES = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
  { value: "cursor", label: "Cursor Agent" },
] as const;

const DEFAULT_COMMANDS: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "agent",
};

const SETTINGS_CONCURRENCY_DEBOUNCE_MS = 400;

/** Debounces rapid typing in numeric concurrency fields so we do not run a mutation per keystroke. */
function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  return useCallback(
    (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}

function formatPhaseLimitDraft(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function PhaseLimitInput({
  label,
  value,
  onCommit,
  inputWidth = "6em",
}: {
  label: string;
  value: number | null | undefined;
  onCommit: (next: number | null) => void;
  inputWidth?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const displayValue = focused ? draft : formatPhaseLimitDraft(value);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <label>{label}</label>
      <input
        type="number"
        min={1}
        placeholder="Unlimited"
        value={displayValue}
        onChange={(e) => {
          const val = e.target.value;
          if (focused) setDraft(val);
          onCommit(val === "" ? null : Math.max(1, Math.floor(Number(val))));
        }}
        onFocus={() => {
          setFocused(true);
          setDraft(formatPhaseLimitDraft(value));
        }}
        onBlur={() => setFocused(false)}
        style={{ width: inputWidth }}
      />
    </div>
  );
}

function AgentAdvancedFields({ form, setForm }: {
  form: AgentAdvancedForm;
  setForm: (update: Partial<AgentAdvancedForm>) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3" style={{ gap: "0.5rem" }}>
      <div className="rounded-lg border border-border bg-card p-3" style={{ gridColumn: "1 / -1" }}>
        <label>Args (one per line)</label>
        <textarea
          placeholder={"--flag\nvalue"}
          value={form.args}
          onChange={(e) => setForm({ args: e.target.value })}
          rows={2}
          style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <label>Timeout (minutes)</label>
        <input
          type="number"
          min={1}
          value={form.timeoutMs}
          onChange={(e) => setForm({ timeoutMs: e.target.value })}
          style={{ width: "6em" }}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <label>Max Retries</label>
        <input
          type="number"
          min={0}
          value={form.maxRetries}
          onChange={(e) => setForm({ maxRetries: e.target.value })}
          style={{ width: "5em" }}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <label>Retry Backoff (seconds)</label>
        <input
          type="number"
          min={1}
          value={form.retryBackoffMs}
          onChange={(e) => setForm({ retryBackoffMs: e.target.value })}
          style={{ width: "6em" }}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <label>Max Retry Backoff (seconds)</label>
        <input
          type="number"
          min={1}
          value={form.maxRetryBackoffMs}
          onChange={(e) => setForm({ maxRetryBackoffMs: e.target.value })}
          style={{ width: "6em" }}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3" style={{ gridColumn: "1 / -1" }}>
        <label>Environment Variables (KEY=VALUE, one per line)</label>
        <textarea
          placeholder={"API_KEY=abc123\nDEBUG=true"}
          value={form.env}
          onChange={(e) => setForm({ env: e.target.value })}
          rows={3}
          style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={form.mcpEnabled}
            onChange={(e) => setForm({ mcpEnabled: e.target.checked })}
          />
          MCP Enabled
        </label>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <label>MCP Tools Filter (comma-separated, empty = all)</label>
        <input
          placeholder="tool1, tool2"
          value={form.mcpTools}
          onChange={(e) => setForm({ mcpTools: e.target.value })}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

export function SettingsView({ projectId }: { projectId: Id<"projects"> }) {
  const project = useQuery(api.projects.get, { id: projectId });
  const columns = useQuery(api.columns.list, { projectId });
  const repos = useQuery(api.repos.list, { projectId });
  const agentConfigs = useQuery(api.agentConfigs.list, { projectId });
  const dispatchStatus = useQuery(api.dispatch.status);

  const updateColumn = useMutation(api.columns.update);
  const createRepo = useMutation(api.repos.create);
  const updateRepo = useMutation(api.repos.update);
  const removeRepo = useMutation(api.repos.remove);
  const createAgentConfig = useMutation(api.agentConfigs.create);
  const updateAgentConfig = useMutation(api.agentConfigs.update);
  const removeAgentConfig = useMutation(api.agentConfigs.remove);
  const updateProject = useMutation(api.projects.update);
  const removeProject = useMutation(api.projects.remove);
  const updateMaxConcurrent = useMutation(api.dispatch.updateMaxConcurrent);
  const debouncedUpdateMaxConcurrent = useDebouncedCallback(
    (args: Parameters<typeof updateMaxConcurrent>[0]) => {
      void updateMaxConcurrent(args);
    },
    SETTINGS_CONCURRENCY_DEBOUNCE_MS,
  );
  const debouncedUpdateProject = useDebouncedCallback(
    (args: Parameters<typeof updateProject>[0]) => {
      void updateProject(args);
    },
    SETTINGS_CONCURRENCY_DEBOUNCE_MS,
  );

  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [repoForm, setRepoForm] = useState({ name: "", path: "", slug: "" });
  const [agentForm, setAgentForm] = useState({
    name: "",
    agentType: "claude-code",
    command: "claude",
    model: "",
    effort: "",
    args: "",
    timeoutMs: "60",
    maxRetries: "3",
    retryBackoffMs: "10",
    maxRetryBackoffMs: "300",
    env: "",
    mcpEnabled: true,
    mcpTools: "",
    permissionMode: "bypass" as string,
  });
  const [showAgentAdvanced, setShowAgentAdvanced] = useState(false);
  const [editingRepoId, setEditingRepoId] = useState<Id<"repos"> | null>(null);
  const [editRepoForm, setEditRepoForm] = useState({
    name: "", path: "", defaultBranch: "",
    setupScript: "", cleanupScript: "",
    scriptTimeoutMs: "", testCommand: "", testTimeoutMs: "",
  });
  const [editingAgentConfigId, setEditingAgentConfigId] = useState<Id<"agentConfigs"> | null>(null);
  const [editAgentConfigForm, setEditAgentConfigForm] = useState({
    name: "", agentType: "", command: "", model: "", effort: "",
    args: "", timeoutMs: "", maxRetries: "", retryBackoffMs: "", maxRetryBackoffMs: "",
    env: "", mcpEnabled: true, mcpTools: "",
    permissionMode: "bypass" as string,
  });
  const [showEditAgentAdvanced, setShowEditAgentAdvanced] = useState(false);

  // Project settings local state (buffered to avoid mutation on every keystroke)
  const [localName, setLocalName] = useState<string>("");
  const [localSlug, setLocalSlug] = useState<string>("");
  const [localPrefix, setLocalPrefix] = useState<string>("");
  const [localMaxReviewCycles, setLocalMaxReviewCycles] = useState<string>("");
  const [localCleanupDelayMin, setLocalCleanupDelayMin] = useState<string>("");

  useEffect(() => {
    if (project) {
      setLocalName(project.name);
      setLocalSlug(project.slug);
      setLocalPrefix(project.simpleIdPrefix);
      setLocalMaxReviewCycles(String(project.maxReviewCycles));
      setLocalCleanupDelayMin(String(Math.round(project.cleanupDelayMs / 60000)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sync individual fields, not the whole object
  }, [project?.name, project?.slug, project?.simpleIdPrefix, project?.maxReviewCycles, project?.cleanupDelayMs]);

  const commitName = useCallback(() => {
    const trimmed = localName.trim();
    if (trimmed && project && trimmed !== project.name) {
      void updateProject({ id: projectId, name: trimmed });
    } else if (project) {
      setLocalName(project.name);
    }
  }, [localName, project, projectId, updateProject]);

  const commitSlug = useCallback(() => {
    const normalized = localSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (normalized && project && normalized !== project.slug) {
      void updateProject({ id: projectId, slug: normalized }).catch(() => {
        setLocalSlug(project.slug);
      });
    } else if (project) {
      setLocalSlug(project.slug);
    }
  }, [localSlug, project, projectId, updateProject]);

  const commitPrefix = useCallback(() => {
    const normalized = localPrefix.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (normalized && project && normalized !== project.simpleIdPrefix) {
      void updateProject({ id: projectId, simpleIdPrefix: normalized });
    } else if (project) {
      setLocalPrefix(project.simpleIdPrefix);
    }
  }, [localPrefix, project, projectId, updateProject]);

  const commitMaxReviewCycles = useCallback(() => {
    const val = Math.floor(Number(localMaxReviewCycles));
    if (Number.isInteger(val) && val >= 0 && val <= 100 && project && val !== project.maxReviewCycles) {
      void updateProject({ id: projectId, maxReviewCycles: val });
    } else if (project) {
      setLocalMaxReviewCycles(String(project.maxReviewCycles));
    }
  }, [localMaxReviewCycles, project, projectId, updateProject]);

  const commitCleanupDelay = useCallback(() => {
    const val = Math.floor(Number(localCleanupDelayMin));
    if (Number.isInteger(val) && val >= 0 && val <= 10080 && project) {
      const ms = val * 60000;
      if (ms !== project.cleanupDelayMs) {
        void updateProject({ id: projectId, cleanupDelayMs: ms });
      }
    } else if (project) {
      setLocalCleanupDelayMin(String(Math.round(project.cleanupDelayMs / 60000)));
    }
  }, [localCleanupDelayMin, project, projectId, updateProject]);

  // Danger zone state
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  if (!project || !columns || !repos || !agentConfigs) {
    return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      Loading settings...
    </div>
  );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <section className="mb-8 max-w-[800px] space-y-3">
        <h2>Project</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Name</label>
            <input
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Slug</label>
            <input
              value={localSlug}
              onChange={(e) => setLocalSlug(e.target.value)}
              onBlur={commitSlug}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Issue ID Prefix</label>
            <input
              value={localPrefix}
              onChange={(e) => setLocalPrefix(e.target.value)}
              onBlur={commitPrefix}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{ width: "8em" }}
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Max Review Cycles</label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={localMaxReviewCycles}
              onChange={(e) => setLocalMaxReviewCycles(e.target.value)}
              onBlur={commitMaxReviewCycles}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{ width: "5em" }}
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Cleanup Delay (min)</label>
            <input
              type="number"
              min={0}
              max={10080}
              step={1}
              value={localCleanupDelayMin}
              onChange={(e) => setLocalCleanupDelayMin(e.target.value)}
              onBlur={commitCleanupDelay}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{ width: "5em" }}
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Planning Agent</label>
            <select
              value={project.planningAgentConfigId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                void updateProject({
                  id: projectId,
                  planningAgentConfigId: val ? (val as Id<"agentConfigs">) : null,
                });
              }}
            >
              <option value="">Same as default</option>
              {agentConfigs.map((ac) => (
                <option key={ac._id} value={ac._id}>
                  {ac.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Auto-Archive (Done)</label>
            <select
              value={project.autoArchiveDelayMs ?? 0}
              onChange={(e) => {
                void updateProject({
                  id: projectId,
                  autoArchiveDelayMs: Number(e.target.value),
                });
              }}
            >
              <option value={0}>Off</option>
              <option value={86400000}>After 24 hours</option>
              <option value={604800000}>After 7 days</option>
              <option value={1209600000}>After 14 days</option>
              <option value={2592000000}>After 30 days</option>
            </select>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Review Agent</label>
            <select
              value={project.reviewAgentConfigId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                void updateProject({
                  id: projectId,
                  reviewAgentConfigId: val ? (val as Id<"agentConfigs">) : null,
                });
              }}
            >
              <option value="">Same as default</option>
              {agentConfigs.map((ac) => (
                <option key={ac._id} value={ac._id}>
                  {ac.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="mb-8 max-w-[800px] space-y-3">
        <h2>Dispatch Status</h2>
        {dispatchStatus && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <label>Worker</label>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  className="worker-status-dot"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    display: "inline-block",
                    backgroundColor: dispatchStatus.workerConnected
                      ? "#10b981"
                      : "#ef4444",
                  }}
                />
                {dispatchStatus.workerConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <label>Last Seen</label>
              <span>
                <WorkerLastSeen lastPollAt={dispatchStatus.lastPollAt} />
              </span>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <label>Running</label>
              <span>{dispatchStatus.runningCount}</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <label>Queued</label>
              <span>{dispatchStatus.queuedCount}</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <label>Max concurrent agents (worker)</label>
              <input
                type="number"
                min={1}
                value={dispatchStatus.maxConcurrent}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val >= 1) debouncedUpdateMaxConcurrent({ maxConcurrentAgents: val });
                }}
                style={{ width: "5em" }}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-3" style={{ gridColumn: "1 / -1" }}>
              <label>Active workspaces by phase</label>
              <span style={{ fontSize: "0.9rem" }}>
                {dispatchStatus.phaseCounts.planning} planning, {dispatchStatus.phaseCounts.coding} coding,{" "}
                {dispatchStatus.phaseCounts.testing} testing, {dispatchStatus.phaseCounts.reviewing} reviewing
              </span>
            </div>
            <PhaseLimitInput
              label="Max concurrent — planning (global)"
              value={dispatchStatus.maxConcurrentPlanning}
              onCommit={(v) => debouncedUpdateMaxConcurrent({ maxConcurrentPlanning: v })}
            />
            <PhaseLimitInput
              label="Max concurrent — coding (global)"
              value={dispatchStatus.maxConcurrentCoding}
              onCommit={(v) => debouncedUpdateMaxConcurrent({ maxConcurrentCoding: v })}
            />
            <PhaseLimitInput
              label="Max concurrent — testing (global)"
              value={dispatchStatus.maxConcurrentTesting}
              onCommit={(v) => debouncedUpdateMaxConcurrent({ maxConcurrentTesting: v })}
            />
            <PhaseLimitInput
              label="Max concurrent — reviewing (global)"
              value={dispatchStatus.maxConcurrentReviewing}
              onCommit={(v) => debouncedUpdateMaxConcurrent({ maxConcurrentReviewing: v })}
            />
          </div>
        )}
      </section>

      <NotificationPrefsSection />

      <section className="mb-8 max-w-[800px] space-y-3">
        <h2>Workflow</h2>
        <p style={{ fontSize: "0.85rem", opacity: 0.85, marginBottom: "0.75rem" }}>
          Board columns are fixed (Backlog → To Do → In Progress → Done). Configure automation behavior per project.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={project.skipPlanning === false}
                onChange={(e) =>
                  void updateProject({
                    id: projectId,
                    skipPlanning: e.target.checked ? false : true,
                  })
                }
              />
              Planning phase
            </label>
          </div>
          {project.skipPlanning === false && (
            <div className="rounded-lg border border-border bg-card p-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={project.autoPlanReview ?? false}
                  onChange={(e) =>
                    void updateProject({ id: projectId, autoPlanReview: e.target.checked })
                  }
                />
                Auto plan review
              </label>
            </div>
          )}
          <PhaseLimitInput
            label="Max concurrent agents (this project)"
            value={project.maxConcurrent}
            onCommit={(v) =>
              debouncedUpdateProject({
                id: projectId,
                maxConcurrent: v,
              })
            }
          />
          <PhaseLimitInput
            label="Max concurrent — planning (this project)"
            value={project.maxConcurrentPlanning}
            onCommit={(v) =>
              debouncedUpdateProject({
                id: projectId,
                maxConcurrentPlanning: v,
              })
            }
          />
          <PhaseLimitInput
            label="Max concurrent — coding (this project)"
            value={project.maxConcurrentCoding}
            onCommit={(v) =>
              debouncedUpdateProject({
                id: projectId,
                maxConcurrentCoding: v,
              })
            }
          />
          <PhaseLimitInput
            label="Max concurrent — testing (this project)"
            value={project.maxConcurrentTesting}
            onCommit={(v) =>
              debouncedUpdateProject({
                id: projectId,
                maxConcurrentTesting: v,
              })
            }
          />
          <PhaseLimitInput
            label="Max concurrent — reviewing (this project)"
            value={project.maxConcurrentReviewing}
            onCommit={(v) =>
              debouncedUpdateProject({
                id: projectId,
                maxConcurrentReviewing: v,
              })
            }
          />
          <div className="rounded-lg border border-border bg-card p-3">
            <label>Merge policy</label>
            <select
              value={project.mergePolicy ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                void updateProject({
                  id: projectId,
                  mergePolicy: val ? val : null,
                });
              }}
            >
              <option value="">None</option>
              <option value="local_merge">Local merge</option>
            </select>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={project.skipReview ?? false}
                onChange={(e) =>
                  void updateProject({ id: projectId, skipReview: e.target.checked })
                }
              />
              Skip review
            </label>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={project.skipTests ?? false}
                onChange={(e) =>
                  void updateProject({ id: projectId, skipTests: e.target.checked })
                }
              />
              Skip tests
            </label>
          </div>
        </div>
      </section>

      <section className="mb-8 max-w-[800px] space-y-3">
        <h2>Board column colors</h2>
        <p style={{ fontSize: "0.85rem", opacity: 0.85, marginBottom: "0.75rem" }}>
          Column names and order cannot be changed. Adjust colors only.
        </p>
        <div className="flex flex-col gap-1">
          {columns.map((col) => (
            <div key={col._id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2 px-3">
              <input
                type="color"
                value={col.color}
                onChange={(e) => void updateColumn({ id: col._id, color: e.target.value })}
                className="size-8 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <span className="font-medium">{col.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 max-w-[800px] space-y-3">
        <h2>
          Repositories
          <Button variant="outline" size="sm" onClick={() => setShowAddRepo(!showAddRepo)}>
            + Add
          </Button>
        </h2>
        {repos.map((repo) => (
          <div key={repo._id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2 px-3">
            {editingRepoId === repo._id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <input
                    placeholder="Name"
                    value={editRepoForm.name}
                    onChange={(e) => setEditRepoForm({ ...editRepoForm, name: e.target.value })}
                    autoComplete="off"
                  />
                  <input
                    placeholder="Path"
                    value={editRepoForm.path}
                    onChange={(e) => setEditRepoForm({ ...editRepoForm, path: e.target.value })}
                    autoComplete="off"
                  />
                  <input
                    placeholder="Default Branch"
                    value={editRepoForm.defaultBranch}
                    onChange={(e) => setEditRepoForm({ ...editRepoForm, defaultBranch: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: "0.85rem", opacity: 0.8 }}>Scripts &amp; Test Configuration</summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <input
                      placeholder="Setup Script (runs before workspace creation)"
                      value={editRepoForm.setupScript}
                      onChange={(e) => setEditRepoForm({ ...editRepoForm, setupScript: e.target.value })}
                      autoComplete="off"
                    />
                    <input
                      placeholder="Cleanup Script (runs on workspace cleanup)"
                      value={editRepoForm.cleanupScript}
                      onChange={(e) => setEditRepoForm({ ...editRepoForm, cleanupScript: e.target.value })}
                      autoComplete="off"
                    />
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>Script Timeout (ms)</label>
                      <input
                        type="number"
                        placeholder="120000"
                        value={editRepoForm.scriptTimeoutMs}
                        onChange={(e) => setEditRepoForm({ ...editRepoForm, scriptTimeoutMs: e.target.value })}
                        style={{ width: "8em" }}
                      />
                    </div>
                    <input
                      placeholder="Test Command"
                      value={editRepoForm.testCommand}
                      onChange={(e) => setEditRepoForm({ ...editRepoForm, testCommand: e.target.value })}
                      autoComplete="off"
                    />
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>Test Timeout (ms)</label>
                      <input
                        type="number"
                        placeholder="300000"
                        value={editRepoForm.testTimeoutMs}
                        onChange={(e) => setEditRepoForm({ ...editRepoForm, testTimeoutMs: e.target.value })}
                        style={{ width: "8em" }}
                      />
                    </div>
                  </div>
                </details>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button size="sm"
                    onClick={async () => {
                      await updateRepo({
                        id: repo._id,
                        name: editRepoForm.name,
                        path: editRepoForm.path,
                        defaultBranch: editRepoForm.defaultBranch,
                        setupScript: editRepoForm.setupScript,
                        cleanupScript: editRepoForm.cleanupScript,
                        scriptTimeoutMs: editRepoForm.scriptTimeoutMs ? Number(editRepoForm.scriptTimeoutMs) : undefined,
                        testCommand: editRepoForm.testCommand,
                        testTimeoutMs: editRepoForm.testTimeoutMs ? Number(editRepoForm.testTimeoutMs) : undefined,
                      });
                      setEditingRepoId(null);
                    }}
                  >
                    Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditingRepoId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <span>{repo.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{repo.path}</span>
                <span className="font-mono text-xs text-muted-foreground">{repo.defaultBranch}</span>
                <Button variant="outline" size="sm"
                  onClick={() => {
                    setEditingRepoId(repo._id);
                    setEditRepoForm({
                      name: repo.name,
                      path: repo.path,
                      defaultBranch: repo.defaultBranch,
                      setupScript: repo.setupScript ?? "",
                      cleanupScript: repo.cleanupScript ?? "",
                      scriptTimeoutMs: String(repo.scriptTimeoutMs),
                      testCommand: repo.testCommand ?? "",
                      testTimeoutMs: String(repo.testTimeoutMs),
                    });
                  }}
                >
                  Edit
                </Button>
                <Button variant="destructive" size="sm"
                  onClick={() => {
                    if (window.confirm(`Delete repository "${repo.name}"?`)) {
                      void removeRepo({ id: repo._id });
                    }
                  }}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        ))}
        {showAddRepo && (
          <form
            className="mt-2 flex flex-wrap gap-2 items-center"
            onSubmit={async (e) => {
              e.preventDefault();
              await createRepo({
                projectId,
                name: repoForm.name,
                slug: repoForm.slug || repoForm.name.toLowerCase().replace(/\s+/g, "-"),
                path: repoForm.path,
              });
              setRepoForm({ name: "", path: "", slug: "" });
              setShowAddRepo(false);
            }}
          >
            <input
              placeholder="Name"
              value={repoForm.name}
              onChange={(e) => setRepoForm({ ...repoForm, name: e.target.value })}
              autoComplete="off"
            />
            <input
              placeholder="Path (absolute)"
              value={repoForm.path}
              onChange={(e) => setRepoForm({ ...repoForm, path: e.target.value })}
              autoComplete="off"
            />
            <Button type="submit" size="sm">
              Add
            </Button>
          </form>
        )}
      </section>

      <section className="mb-8 max-w-[800px] space-y-3">
        <h2>
          Agent Configurations
          <Button variant="outline" size="sm" onClick={() => setShowAddAgent(!showAddAgent)}>
            + Add
          </Button>
        </h2>
        {agentConfigs.map((ac) => (
          <div key={ac._id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2 px-3">
            {editingAgentConfigId === ac._id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <input
                    placeholder="Name"
                    value={editAgentConfigForm.name}
                    onChange={(e) => setEditAgentConfigForm({ ...editAgentConfigForm, name: e.target.value })}
                    autoComplete="off"
                  />
                  <select
                    value={editAgentConfigForm.agentType}
                    onChange={(e) => setEditAgentConfigForm({ ...editAgentConfigForm, agentType: e.target.value })}
                  >
                    {AGENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Command"
                    value={editAgentConfigForm.command}
                    onChange={(e) => setEditAgentConfigForm({ ...editAgentConfigForm, command: e.target.value })}
                    autoComplete="off"
                  />
                  <input
                    placeholder="Model (optional)"
                    value={editAgentConfigForm.model}
                    onChange={(e) => setEditAgentConfigForm({ ...editAgentConfigForm, model: e.target.value })}
                    autoComplete="off"
                  />
                  <select
                    aria-label="Effort"
                    value={editAgentConfigForm.effort}
                    onChange={(e) => setEditAgentConfigForm({ ...editAgentConfigForm, effort: e.target.value })}
                  >
                    <option value="">Default</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <select
                    aria-label="Permission mode"
                    value={editAgentConfigForm.permissionMode}
                    onChange={(e) => setEditAgentConfigForm({ ...editAgentConfigForm, permissionMode: e.target.value })}
                  >
                    <option value="bypass">Bypass (auto-approve)</option>
                    <option value="accept">Accept (require approval)</option>
                  </select>
                </div>
                <Button variant="outline" size="sm"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => setShowEditAgentAdvanced(!showEditAgentAdvanced)}
                >
                  {showEditAgentAdvanced ? "Hide" : "Show"} Advanced Settings
                </Button>
                {showEditAgentAdvanced && (
                  <AgentAdvancedFields
                    form={editAgentConfigForm}
                    setForm={(update) => setEditAgentConfigForm({ ...editAgentConfigForm, ...update })}
                  />
                )}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button size="sm"
                    onClick={async () => {
                      const error = validateAgentAdvanced(editAgentConfigForm);
                      if (error) { alert(error); return; }
                      await updateAgentConfig({
                        id: ac._id,
                        name: editAgentConfigForm.name,
                        agentType: editAgentConfigForm.agentType,
                        command: editAgentConfigForm.command,
                        model: editAgentConfigForm.model || undefined,
                        effort:
                          editAgentConfigForm.effort === ""
                            ? null
                            : (editAgentConfigForm.effort as "low" | "medium" | "high"),
                        args: parseArgs(editAgentConfigForm.args),
                        timeoutMs: Number(editAgentConfigForm.timeoutMs) * 60000,
                        maxRetries: Number(editAgentConfigForm.maxRetries),
                        retryBackoffMs: Number(editAgentConfigForm.retryBackoffMs) * 1000,
                        maxRetryBackoffMs: Number(editAgentConfigForm.maxRetryBackoffMs) * 1000,
                        env: parseEnvString(editAgentConfigForm.env),
                        mcpEnabled: editAgentConfigForm.mcpEnabled,
                        mcpTools: parseOptionalStringArray(editAgentConfigForm.mcpTools),
                        permissionMode: editAgentConfigForm.permissionMode as "bypass" | "accept",
                      });
                      setEditingAgentConfigId(null);
                      setShowEditAgentAdvanced(false);
                    }}
                  >
                    Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setEditingAgentConfigId(null); setShowEditAgentAdvanced(false); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <span>{ac.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{ac.agentType}</span>
                <span className="font-mono text-xs text-muted-foreground">{ac.command}</span>
                {ac.permissionMode === "accept" && (
                  <span className="badge badge-permission">accept</span>
                )}
                {project.defaultAgentConfigId === ac._id && (
                  <span className="badge">Default</span>
                )}
                {project.defaultAgentConfigId !== ac._id && (
                  <Button variant="outline" size="sm"
                    onClick={() => updateProject({ id: projectId, defaultAgentConfigId: ac._id })}
                  >
                    Set Default
                  </Button>
                )}
                <Button variant="outline" size="sm"
                  onClick={() => {
                    setEditingAgentConfigId(ac._id);
                    setShowEditAgentAdvanced(false);
                    setEditAgentConfigForm({
                      name: ac.name,
                      agentType: ac.agentType,
                      command: ac.command,
                      model: ac.model ?? "",
                      effort: ac.effort ?? "",
                      args: argsToString(ac.args),
                      timeoutMs: String(Math.round(ac.timeoutMs / 60000)),
                      maxRetries: String(ac.maxRetries),
                      retryBackoffMs: String(Math.round(ac.retryBackoffMs / 1000)),
                      maxRetryBackoffMs: String(Math.round(ac.maxRetryBackoffMs / 1000)),
                      env: envToString(ac.env),
                      mcpEnabled: ac.mcpEnabled,
                      mcpTools: (ac.mcpTools ?? []).join(", "),
                      permissionMode: ac.permissionMode ?? "bypass",
                    });
                  }}
                >
                  Edit
                </Button>
                {project.defaultAgentConfigId !== ac._id && (
                  <Button variant="destructive" size="sm"
                    onClick={() => {
                      if (window.confirm(`Delete agent config "${ac.name}"?`)) {
                        void removeAgentConfig({ id: ac._id });
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
        {showAddAgent && (
          <form
            className="mt-2 flex flex-wrap gap-2 items-center"
            style={{ flexDirection: "column", alignItems: "stretch" }}
            onSubmit={async (e) => {
              e.preventDefault();
              const error = validateAgentAdvanced(agentForm);
              if (error) { alert(error); return; }
              await createAgentConfig({
                projectId,
                name: agentForm.name,
                agentType: agentForm.agentType,
                command: agentForm.command,
                model: agentForm.model || undefined,
                effort:
                  agentForm.effort === ""
                    ? undefined
                    : (agentForm.effort as "low" | "medium" | "high"),
                args: parseArgs(agentForm.args),
                timeoutMs: Number(agentForm.timeoutMs) * 60000,
                maxRetries: Number(agentForm.maxRetries),
                retryBackoffMs: Number(agentForm.retryBackoffMs) * 1000,
                maxRetryBackoffMs: Number(agentForm.maxRetryBackoffMs) * 1000,
                env: parseEnvString(agentForm.env),
                mcpEnabled: agentForm.mcpEnabled,
                mcpTools: parseOptionalStringArray(agentForm.mcpTools),
                permissionMode: agentForm.permissionMode as "bypass" | "accept",
              });
              setAgentForm({
                name: "", agentType: "claude-code", command: "claude", model: "", effort: "",
                args: "", timeoutMs: "60", maxRetries: "3", retryBackoffMs: "10",
                maxRetryBackoffMs: "300", env: "", mcpEnabled: true, mcpTools: "",
                permissionMode: "bypass",
              });
              setShowAddAgent(false);
              setShowAgentAdvanced(false);
            }}
          >
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                placeholder="Name"
                value={agentForm.name}
                onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
                autoComplete="off"
              />
              <select
                value={agentForm.agentType}
                onChange={(e) => {
                  const agentType = e.target.value;
                  setAgentForm({ ...agentForm, agentType, command: DEFAULT_COMMANDS[agentType] ?? agentType });
                }}
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                placeholder="Command"
                value={agentForm.command}
                onChange={(e) => setAgentForm({ ...agentForm, command: e.target.value })}
                autoComplete="off"
              />
              <input
                placeholder="Model (optional)"
                value={agentForm.model}
                onChange={(e) => setAgentForm({ ...agentForm, model: e.target.value })}
                autoComplete="off"
              />
              <select
                aria-label="Effort"
                value={agentForm.effort}
                onChange={(e) => setAgentForm({ ...agentForm, effort: e.target.value })}
              >
                <option value="">Default</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <select
                aria-label="Permission mode"
                value={agentForm.permissionMode}
                onChange={(e) => setAgentForm({ ...agentForm, permissionMode: e.target.value })}
              >
                <option value="bypass">Bypass (auto-approve)</option>
                <option value="accept">Accept (require approval)</option>
              </select>
            </div>
            <Button type="button" variant="outline" size="sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setShowAgentAdvanced(!showAgentAdvanced)}
            >
              {showAgentAdvanced ? "Hide" : "Show"} Advanced Settings
            </Button>
            {showAgentAdvanced && (
              <AgentAdvancedFields
                form={agentForm}
                setForm={(update) => setAgentForm({ ...agentForm, ...update })}
              />
            )}
            <Button type="submit" size="sm" style={{ alignSelf: "flex-start" }}>
              Add
            </Button>
          </form>
        )}
      </section>

      <PromptTemplatesSection projectId={projectId} />

      <IssueTemplatesSection projectId={projectId} />

      <section
        className="mb-8 max-w-[800px] space-y-3"
        style={{
          border: "1px solid #ef4444",
          borderRadius: "8px",
          padding: "1rem",
          marginTop: "2rem",
        }}
      >
        <h2 style={{ color: "#ef4444" }}>Danger Zone</h2>
        {!showDeleteProject ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2 px-3">
            <span>Permanently delete this project and all its data.</span>
            <Button variant="destructive" size="sm"
              onClick={() => setShowDeleteProject(true)}
            >
              Delete Project
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2 px-3" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
            <p>
              Type <strong>{project.name}</strong> to confirm deletion. This action cannot be undone.
            </p>
            <input
              placeholder="Project name"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button variant="destructive" size="sm"
                disabled={deleteConfirmName !== project.name}
                onClick={async () => {
                  await removeProject({ id: projectId });
                }}
              >
                Confirm Delete
              </Button>
              <Button variant="outline" size="sm"
                onClick={() => {
                  setShowDeleteProject(false);
                  setDeleteConfirmName("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function WorkerLastSeen({ lastPollAt }: { lastPollAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (lastPollAt === null) return <>Never</>;

  const seconds = Math.round((now - lastPollAt) / 1000);
  if (seconds < 5) return <>Just now</>;
  if (seconds < 60) return <>{seconds}s ago</>;
  const minutes = Math.round(seconds / 60);
  return <>{minutes}m ago</>;
}
