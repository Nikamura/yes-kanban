import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { PromptTemplatesSection } from "./PromptTemplatesSection";
import { IssueTemplatesSection } from "./IssueTemplatesSection";
import { RecurrenceRulesSection } from "./RecurrenceRulesSection";
import { NotificationPrefsSection } from "./NotificationPrefsSection";
import { WebhookDeliveriesSection } from "./WebhookDeliveriesSection";
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
  { value: "pi", label: "Pi (pi.dev)" },
] as const;

const DEFAULT_COMMANDS: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  gemini: "gemini",
  cursor: "agent",
  pi: "pi",
};

const WEBHOOK_EVENTS = [
  "dispatch",
  "completion",
  "failure",
  "test_failed",
  "review_complete",
  "pr_created",
  "merged",
] as const;

function AgentAdvancedFields({ form, setForm }: {
  form: AgentAdvancedForm;
  setForm: (update: Partial<AgentAdvancedForm>) => void;
}) {
  return (
    <div className="settings-grid" style={{ gap: "0.5rem" }}>
      <div className="setting-item" style={{ gridColumn: "1 / -1" }}>
        <label>Args (one per line)</label>
        <textarea
          placeholder={"--flag\nvalue"}
          value={form.args}
          onChange={(e) => setForm({ args: e.target.value })}
          rows={2}
          style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
        />
      </div>
      <div className="setting-item">
        <label>Timeout (minutes)</label>
        <input
          type="number"
          min={1}
          value={form.timeoutMs}
          onChange={(e) => setForm({ timeoutMs: e.target.value })}
          style={{ width: "6em" }}
        />
      </div>
      <div className="setting-item">
        <label>Max Retries</label>
        <input
          type="number"
          min={0}
          value={form.maxRetries}
          onChange={(e) => setForm({ maxRetries: e.target.value })}
          style={{ width: "5em" }}
        />
      </div>
      <div className="setting-item">
        <label>Retry Backoff (seconds)</label>
        <input
          type="number"
          min={1}
          value={form.retryBackoffMs}
          onChange={(e) => setForm({ retryBackoffMs: e.target.value })}
          style={{ width: "6em" }}
        />
      </div>
      <div className="setting-item">
        <label>Max Retry Backoff (seconds)</label>
        <input
          type="number"
          min={1}
          value={form.maxRetryBackoffMs}
          onChange={(e) => setForm({ maxRetryBackoffMs: e.target.value })}
          style={{ width: "6em" }}
        />
      </div>
      <div className="setting-item" style={{ gridColumn: "1 / -1" }}>
        <label>Environment Variables (KEY=VALUE, one per line)</label>
        <textarea
          placeholder={"API_KEY=abc123\nDEBUG=true"}
          value={form.env}
          onChange={(e) => setForm({ env: e.target.value })}
          rows={3}
          style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
        />
      </div>
      <div className="setting-item">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={form.mcpEnabled}
            onChange={(e) => setForm({ mcpEnabled: e.target.checked })}
          />
          MCP Enabled
        </label>
      </div>
      <div className="setting-item">
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
  const webhooks = useQuery(api.webhooks.list, { projectId });
  const mcpServerConfigs = useQuery(api.mcpServerConfigs.list, { projectId });
  const skills = useQuery(api.skills.list, { projectId });

  const updateColumn = useMutation(api.columns.update);
  const createColumn = useMutation(api.columns.create);
  const removeColumn = useMutation(api.columns.remove);
  const createRepo = useMutation(api.repos.create);
  const updateRepo = useMutation(api.repos.update);
  const removeRepo = useMutation(api.repos.remove);
  const createAgentConfig = useMutation(api.agentConfigs.create);
  const updateAgentConfig = useMutation(api.agentConfigs.update);
  const removeAgentConfig = useMutation(api.agentConfigs.remove);
  const removeAllowedTool = useMutation(api.agentConfigs.removeAllowedTool);
  const updateProject = useMutation(api.projects.update);
  const removeProject = useMutation(api.projects.remove);
  const updateMaxConcurrent = useMutation(api.dispatch.updateMaxConcurrent);
  const createWebhook = useMutation(api.webhooks.create);
  const updateWebhook = useMutation(api.webhooks.update);
  const removeWebhook = useMutation(api.webhooks.remove);
  const syncMcpFromJson = useMutation(api.mcpServerConfigs.syncFromJson);
  const updateSkill = useMutation(api.skills.update);
  const removeSkill = useMutation(api.skills.remove);
  const installSkill = useAction(api.skills.installFromSource);
  const updateSkillFromSource = useAction(api.skills.updateFromSource);

  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [repoForm, setRepoForm] = useState({ name: "", path: "", slug: "" });
  const [agentForm, setAgentForm] = useState({
    name: "",
    agentType: "claude-code",
    command: "claude",
    model: "",
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
    setupScript: "", beforeRunScript: "", afterRunScript: "", cleanupScript: "",
    scriptTimeoutMs: "", testCommand: "", testTimeoutMs: "",
  });
  const [editingAgentConfigId, setEditingAgentConfigId] = useState<Id<"agentConfigs"> | null>(null);
  const [editAgentConfigForm, setEditAgentConfigForm] = useState({
    name: "", agentType: "", command: "", model: "",
    args: "", timeoutMs: "", maxRetries: "", retryBackoffMs: "", maxRetryBackoffMs: "",
    env: "", mcpEnabled: true, mcpTools: "",
    permissionMode: "bypass" as string,
  });
  const [showEditAgentAdvanced, setShowEditAgentAdvanced] = useState(false);
  const [webhookForm, setWebhookForm] = useState({
    url: "",
    secret: "",
    events: [...WEBHOOK_EVENTS] as string[],
  });
  const [editingWebhookId, setEditingWebhookId] = useState<Id<"webhooks"> | null>(null);
  const [editWebhookForm, setEditWebhookForm] = useState({
    url: "",
    secret: "",
    events: [] as string[],
  });
  const [mcpJsonValue, setMcpJsonValue] = useState("");
  const [mcpJsonDirty, setMcpJsonDirty] = useState(false);
  const [mcpJsonError, setMcpJsonError] = useState<string | null>(null);
  const [mcpJsonSaving, setMcpJsonSaving] = useState(false);
  const [showInstallSkill, setShowInstallSkill] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [updatingSkillId, setUpdatingSkillId] = useState<Id<"skills"> | null>(null);
  const [updateSkillError, setUpdateSkillError] = useState<{ id: Id<"skills">; message: string } | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<Id<"skills"> | null>(null);
  const [editSkillForm, setEditSkillForm] = useState({ name: "", description: "", content: "" });

  // Column management state
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [columnForm, setColumnForm] = useState({ name: "", color: "#6366f1" });
  const [editingColumnId, setEditingColumnId] = useState<Id<"columns"> | null>(null);
  const [editColumnName, setEditColumnName] = useState("");
  const [deletingColumnId, setDeletingColumnId] = useState<Id<"columns"> | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<Id<"columns"> | null>(null);

  // Project settings local state (buffered to avoid mutation on every keystroke)
  const [localMaxReviewCycles, setLocalMaxReviewCycles] = useState<string>("");
  const [localCleanupDelayMin, setLocalCleanupDelayMin] = useState<string>("");

  useEffect(() => {
    if (project) {
      setLocalMaxReviewCycles(String(project.maxReviewCycles));
      setLocalCleanupDelayMin(String(Math.round(project.cleanupDelayMs / 60000)));
    }
  }, [project?.maxReviewCycles, project?.cleanupDelayMs]);

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

  // Convert DB MCP configs to standard JSON format for the editor
  useEffect(() => {
    if (mcpJsonDirty || !mcpServerConfigs) return;
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const c of mcpServerConfigs) {
      const entry: Record<string, unknown> = { command: c.command, args: c.args };
      if (c.env && Object.keys(c.env).length > 0) entry["env"] = c.env;
      if (!c.enabled) entry["enabled"] = false;
      mcpServers[c.name] = entry;
    }
    setMcpJsonValue(JSON.stringify({ mcpServers }, null, 2));
  }, [mcpServerConfigs, mcpJsonDirty]);

  if (!project || !columns || !repos || !agentConfigs || webhooks === undefined) {
    return <div className="loading">Loading settings...</div>;
  }

  return (
    <div className="settings">
      <section className="settings-section">
        <h2>Project: {project.name}</h2>
        <div className="settings-grid">
          <div className="setting-item">
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
          <div className="setting-item">
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
          <div className="setting-item">
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
          <div className="setting-item">
            <label>Auto-Archive Done</label>
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
          <div className="setting-item">
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

      <section className="settings-section">
        <h2>Dispatch Status</h2>
        {dispatchStatus && (
          <div className="settings-grid">
            <div className="setting-item">
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
            <div className="setting-item">
              <label>Last Seen</label>
              <span>
                <WorkerLastSeen lastPollAt={dispatchStatus.lastPollAt} />
              </span>
            </div>
            <div className="setting-item">
              <label>Running</label>
              <span>{dispatchStatus.runningCount}</span>
            </div>
            <div className="setting-item">
              <label>Queued</label>
              <span>{dispatchStatus.queuedCount}</span>
            </div>
            <div className="setting-item">
              <label>Max Concurrent</label>
              <input
                type="number"
                min={1}
                value={dispatchStatus.maxConcurrent}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val >= 1) void updateMaxConcurrent({ maxConcurrentAgents: val });
                }}
                style={{ width: "5em" }}
              />
            </div>
          </div>
        )}
      </section>

      <NotificationPrefsSection />

      <section className="settings-section">
        <h2>
          Columns
          <button className="btn btn-sm" onClick={() => setShowAddColumn(!showAddColumn)}>
            + Add
          </button>
        </h2>
        {showAddColumn && (
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await createColumn({
                projectId,
                name: columnForm.name,
                color: columnForm.color,
              });
              setColumnForm({ name: "", color: "#6366f1" });
              setShowAddColumn(false);
            }}
          >
            <input
              placeholder="Column name"
              value={columnForm.name}
              onChange={(e) => setColumnForm({ ...columnForm, name: e.target.value })}
              autoComplete="off"
            />
            <input
              type="color"
              value={columnForm.color}
              onChange={(e) => setColumnForm({ ...columnForm, color: e.target.value })}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!columnForm.name.trim()}>
              Add
            </button>
          </form>
        )}
        <div className="settings-table">
          {columns.map((col, index) => (
            <div key={col._id} className="settings-row">
              <input
                type="color"
                value={col.color}
                onChange={(e) => updateColumn({ id: col._id, color: e.target.value })}
                className="color-input"
              />
              {editingColumnId === col._id ? (
                <input
                  className="col-name-input"
                  value={editColumnName}
                  autoFocus
                  autoComplete="off"
                  onChange={(e) => setEditColumnName(e.target.value)}
                  onBlur={() => {
                    if (editColumnName.trim() && editColumnName !== col.name) {
                      void updateColumn({ id: col._id, name: editColumnName.trim() });
                    }
                    setEditingColumnId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === "Escape") {
                      setEditingColumnId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="col-name col-name-editable"
                  onClick={() => {
                    setEditingColumnId(col._id);
                    setEditColumnName(col.name);
                  }}
                >
                  {col.name}
                </span>
              )}
              <div className="col-reorder-btns">
                <button
                  className="btn btn-sm"
                  disabled={index === 0}
                  onClick={() => {
                    const prev = columns[index - 1];
                    if (!prev) return;
                    void updateColumn({ id: col._id, position: prev.position });
                    void updateColumn({ id: prev._id, position: col.position });
                  }}
                >
                  ↑
                </button>
                <button
                  className="btn btn-sm"
                  disabled={index === columns.length - 1}
                  onClick={() => {
                    const next = columns[index + 1];
                    if (!next) return;
                    void updateColumn({ id: col._id, position: next.position });
                    void updateColumn({ id: next._id, position: col.position });
                  }}
                >
                  ↓
                </button>
              </div>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={col.visible}
                  onChange={(e) =>
                    updateColumn({ id: col._id, visible: e.target.checked })
                  }
                />
                Visible
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={col.autoDispatch}
                  onChange={(e) =>
                    updateColumn({ id: col._id, autoDispatch: e.target.checked })
                  }
                />
                Auto-dispatch
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={!col.skipPlanning}
                  onChange={(e) =>
                    updateColumn({ id: col._id, skipPlanning: !e.target.checked })
                  }
                />
                Planning phase
              </label>
              {!col.skipPlanning && (
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={col.autoPlanReview ?? false}
                    onChange={(e) =>
                      updateColumn({ id: col._id, autoPlanReview: e.target.checked })
                    }
                  />
                  Auto plan review
                </label>
              )}
              {col.autoDispatch && (
                <label className="toggle-label">
                  Max Concurrent
                  <input
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={col.maxConcurrent ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const args: Parameters<typeof updateColumn>[0] = {
                        id: col._id,
                      };
                      if (val) args.maxConcurrent = Number(val);
                      void updateColumn(args);
                    }}
                    style={{ width: "5em", marginLeft: "0.5em" }}
                  />
                </label>
              )}
              <label className="toggle-label">
                Merge Policy
                <select
                  value={col.mergePolicy ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    void updateColumn({
                      id: col._id,
                      mergePolicy: val || null,
                    });
                  }}
                  style={{ marginLeft: "0.5em" }}
                >
                  <option value="">None</option>
                  <option value="local_merge">Local merge</option>
                  <option value="auto_merge">Auto merge</option>
                  <option value="manual_merge">Manual merge</option>
                </select>
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={col.skipReview}
                  onChange={(e) =>
                    updateColumn({ id: col._id, skipReview: e.target.checked })
                  }
                />
                Skip review
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={col.skipTests}
                  onChange={(e) =>
                    updateColumn({ id: col._id, skipTests: e.target.checked })
                  }
                />
                Skip tests
              </label>
              {deletingColumnId === col._id ? (
                <span className="delete-confirm">
                  <span>Move issues to:</span>
                  <select
                    value={deleteTargetId ?? ""}
                    onChange={(e) => setDeleteTargetId(e.target.value as Id<"columns">)}
                  >
                    <option value="">Select column</option>
                    {columns
                      .filter((c) => c._id !== col._id)
                      .map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={!deleteTargetId}
                    onClick={async () => {
                      if (deleteTargetId) {
                        await removeColumn({ id: col._id, targetColumnId: deleteTargetId });
                        setDeletingColumnId(null);
                        setDeleteTargetId(null);
                      }
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setDeletingColumnId(null);
                      setDeleteTargetId(null);
                    }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className="btn btn-sm btn-danger"
                  disabled={columns.length <= 1}
                  onClick={() => {
                    setDeletingColumnId(col._id);
                    setDeleteTargetId(null);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>
          Repositories
          <button className="btn btn-sm" onClick={() => setShowAddRepo(!showAddRepo)}>
            + Add
          </button>
        </h2>
        {repos.map((repo) => (
          <div key={repo._id} className="settings-row">
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
                      placeholder="Before Run Script (runs before each agent run)"
                      value={editRepoForm.beforeRunScript}
                      onChange={(e) => setEditRepoForm({ ...editRepoForm, beforeRunScript: e.target.value })}
                      autoComplete="off"
                    />
                    <input
                      placeholder="After Run Script (runs after each agent run)"
                      value={editRepoForm.afterRunScript}
                      onChange={(e) => setEditRepoForm({ ...editRepoForm, afterRunScript: e.target.value })}
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
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      await updateRepo({
                        id: repo._id,
                        name: editRepoForm.name,
                        path: editRepoForm.path,
                        defaultBranch: editRepoForm.defaultBranch,
                        setupScript: editRepoForm.setupScript,
                        beforeRunScript: editRepoForm.beforeRunScript,
                        afterRunScript: editRepoForm.afterRunScript,
                        cleanupScript: editRepoForm.cleanupScript,
                        scriptTimeoutMs: editRepoForm.scriptTimeoutMs ? Number(editRepoForm.scriptTimeoutMs) : undefined,
                        testCommand: editRepoForm.testCommand,
                        testTimeoutMs: editRepoForm.testTimeoutMs ? Number(editRepoForm.testTimeoutMs) : undefined,
                      });
                      setEditingRepoId(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditingRepoId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span>{repo.name}</span>
                <span className="meta-value">{repo.path}</span>
                <span className="meta-value">{repo.defaultBranch}</span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditingRepoId(repo._id);
                    setEditRepoForm({
                      name: repo.name,
                      path: repo.path,
                      defaultBranch: repo.defaultBranch,
                      setupScript: repo.setupScript ?? "",
                      beforeRunScript: repo.beforeRunScript ?? "",
                      afterRunScript: repo.afterRunScript ?? "",
                      cleanupScript: repo.cleanupScript ?? "",
                      scriptTimeoutMs: repo.scriptTimeoutMs != null ? String(repo.scriptTimeoutMs) : "",
                      testCommand: repo.testCommand ?? "",
                      testTimeoutMs: repo.testTimeoutMs != null ? String(repo.testTimeoutMs) : "",
                    });
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    if (window.confirm(`Delete repository "${repo.name}"?`)) {
                      void removeRepo({ id: repo._id });
                    }
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ))}
        {showAddRepo && (
          <form
            className="inline-form"
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
            <button type="submit" className="btn btn-primary btn-sm">
              Add
            </button>
          </form>
        )}
      </section>

      <section className="settings-section">
        <h2>
          Agent Configurations
          <button className="btn btn-sm" onClick={() => setShowAddAgent(!showAddAgent)}>
            + Add
          </button>
        </h2>
        {agentConfigs.map((ac) => (
          <div key={ac._id} className="settings-row">
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
                    aria-label="Permission mode"
                    value={editAgentConfigForm.permissionMode}
                    onChange={(e) => setEditAgentConfigForm({ ...editAgentConfigForm, permissionMode: e.target.value })}
                  >
                    <option value="bypass">Bypass (auto-approve)</option>
                    <option value="accept">Accept (require approval)</option>
                  </select>
                </div>
                <button
                  className="btn btn-sm"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => setShowEditAgentAdvanced(!showEditAgentAdvanced)}
                >
                  {showEditAgentAdvanced ? "Hide" : "Show"} Advanced Settings
                </button>
                {showEditAgentAdvanced && (
                  <AgentAdvancedFields
                    form={editAgentConfigForm}
                    setForm={(update) => setEditAgentConfigForm({ ...editAgentConfigForm, ...update })}
                  />
                )}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      const error = validateAgentAdvanced(editAgentConfigForm);
                      if (error) { alert(error); return; }
                      await updateAgentConfig({
                        id: ac._id,
                        name: editAgentConfigForm.name,
                        agentType: editAgentConfigForm.agentType,
                        command: editAgentConfigForm.command,
                        model: editAgentConfigForm.model || undefined,
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
                  </button>
                  <button className="btn btn-sm" onClick={() => { setEditingAgentConfigId(null); setShowEditAgentAdvanced(false); }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span>{ac.name}</span>
                <span className="meta-value">{ac.agentType}</span>
                <span className="meta-value">{ac.command}</span>
                {ac.permissionMode === "accept" && (
                  <span className="badge badge-permission">accept</span>
                )}
                {project.defaultAgentConfigId === ac._id && (
                  <span className="badge">Default</span>
                )}
                {project.defaultAgentConfigId !== ac._id && (
                  <button
                    className="btn btn-sm"
                    onClick={() => updateProject({ id: projectId, defaultAgentConfigId: ac._id })}
                  >
                    Set Default
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditingAgentConfigId(ac._id);
                    setShowEditAgentAdvanced(false);
                    setEditAgentConfigForm({
                      name: ac.name,
                      agentType: ac.agentType,
                      command: ac.command,
                      model: ac.model ?? "",
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
                </button>
                {project.defaultAgentConfigId !== ac._id && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (window.confirm(`Delete agent config "${ac.name}"?`)) {
                        void removeAgentConfig({ id: ac._id });
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
                {(ac.allowedToolPatterns ?? []).length > 0 && (
                  <div className="allowed-tools-list">
                    <span className="allowed-tools-label">Auto-approved:</span>
                    {ac.allowedToolPatterns!.map((pattern) => (
                      <span key={pattern} className="allowed-tool-chip">
                        {pattern}
                        <button
                          className="allowed-tool-remove"
                          title={`Revoke auto-approval for ${pattern}`}
                          onClick={() => {
                            if (window.confirm(`Revoke auto-approval for "${pattern}"? Future runs will require manual approval.`)) {
                              void removeAllowedTool({ id: ac._id, toolPattern: pattern });
                            }
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {showAddAgent && (
          <form
            className="inline-form"
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
                name: "", agentType: "claude-code", command: "claude", model: "",
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
                aria-label="Permission mode"
                value={agentForm.permissionMode}
                onChange={(e) => setAgentForm({ ...agentForm, permissionMode: e.target.value })}
              >
                <option value="bypass">Bypass (auto-approve)</option>
                <option value="accept">Accept (require approval)</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setShowAgentAdvanced(!showAgentAdvanced)}
            >
              {showAgentAdvanced ? "Hide" : "Show"} Advanced Settings
            </button>
            {showAgentAdvanced && (
              <AgentAdvancedFields
                form={agentForm}
                setForm={(update) => setAgentForm({ ...agentForm, ...update })}
              />
            )}
            <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }}>
              Add
            </button>
          </form>
        )}
      </section>

      <section className="settings-section">
        <h2>MCP Servers</h2>
        <p className="settings-hint" style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.5rem" }}>
          Configure external MCP servers in standard JSON format. Set <code>"enabled": false</code> to disable a server.
        </p>
        <label className="toggle-label" style={{ marginBottom: "0.5rem" }}>
          <input
            type="checkbox"
            checked={project.disableBuiltInMcp ?? false}
            onChange={(e) => void updateProject({ id: projectId, disableBuiltInMcp: e.target.checked })}
          />
          Disable built-in yes-kanban MCP (only use configured servers below)
        </label>
        <div style={{ border: "1px solid var(--border)", borderRadius: "4px", overflow: "hidden" }}>
          <Editor
            height="300px"
            language="json"
            theme="vs-dark"
            value={mcpJsonValue}
            onChange={(value) => {
              setMcpJsonValue(value ?? "");
              setMcpJsonDirty(true);
              setMcpJsonError(null);
            }}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              lineNumbers: "on",
              tabSize: 2,
            }}
          />
        </div>
        {mcpJsonError && (
          <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.25rem" }}>{mcpJsonError}</p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={!mcpJsonDirty || mcpJsonSaving}
            onClick={async () => {
              try {
                const parsed = JSON.parse(mcpJsonValue);
                if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
                  setMcpJsonError('JSON must have a "mcpServers" object at the top level');
                  return;
                }
                for (const [name, config] of Object.entries(parsed.mcpServers)) {
                  const cfg = config as Record<string, unknown>;
                  if (!cfg["command"] || typeof cfg["command"] !== "string") {
                    setMcpJsonError(`Server "${name}" must have a "command" string`);
                    return;
                  }
                  if (cfg["args"] !== undefined && !Array.isArray(cfg["args"])) {
                    setMcpJsonError(`Server "${name}": "args" must be an array of strings`);
                    return;
                  }
                }
                setMcpJsonSaving(true);
                setMcpJsonError(null);
                await syncMcpFromJson({ projectId, mcpServers: parsed.mcpServers });
                setMcpJsonDirty(false);
              } catch (err) {
                setMcpJsonError(err instanceof SyntaxError ? `Invalid JSON: ${err.message}` : String(err));
              } finally {
                setMcpJsonSaving(false);
              }
            }}
          >
            {mcpJsonSaving ? "Saving..." : "Save"}
          </button>
          <button
            className="btn btn-sm"
            disabled={!mcpJsonDirty}
            onClick={() => {
              setMcpJsonDirty(false);
              setMcpJsonError(null);
            }}
          >
            Reset
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>
          Skills
          <button className="btn btn-sm" onClick={() => { setShowInstallSkill(!showInstallSkill); setInstallError(null); }}>
            + Install
          </button>
        </h2>
        <p className="settings-hint" style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.5rem" }}>
          Install skills from remote sources. When no skills are configured, all slash commands are disabled.
        </p>
        {showInstallSkill && (
          <form
            className="inline-form"
            style={{ flexDirection: "column", alignItems: "stretch", marginBottom: "0.5rem" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!installSource.trim()) return;
              setInstalling(true);
              setInstallError(null);
              try {
                await installSkill({ projectId, sourceRef: installSource.trim() });
                setInstallSource("");
                setShowInstallSkill(false);
              } catch (err) {
                setInstallError(err instanceof Error ? err.message : String(err));
              } finally {
                setInstalling(false);
              }
            }}
          >
            <input
              placeholder="URL, npm:package-name, or owner/repo"
              value={installSource}
              onChange={(e) => setInstallSource(e.target.value)}
              autoComplete="off"
              disabled={installing}
            />
            {installError && (
              <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: 0 }}>{installError}</p>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!installSource.trim() || installing}>
                {installing ? "Installing..." : "Install"}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => { setShowInstallSkill(false); setInstallError(null); }} disabled={installing}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {skills?.map((skill) => (
          <div key={skill._id} className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            {editingSkillId === skill._id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <input
                  placeholder="Name"
                  value={editSkillForm.name}
                  onChange={(e) => setEditSkillForm({ ...editSkillForm, name: e.target.value })}
                  autoComplete="off"
                />
                <input
                  placeholder="Description (when to trigger)"
                  value={editSkillForm.description}
                  onChange={(e) => setEditSkillForm({ ...editSkillForm, description: e.target.value })}
                  autoComplete="off"
                />
                <textarea
                  placeholder="Skill content (Markdown)"
                  value={editSkillForm.content}
                  onChange={(e) => setEditSkillForm({ ...editSkillForm, content: e.target.value })}
                  rows={6}
                  style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      await updateSkill({
                        id: skill._id,
                        name: editSkillForm.name,
                        description: editSkillForm.description,
                        content: editSkillForm.content,
                      });
                      setEditingSkillId(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditingSkillId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <span>{skill.name}</span>
                {skill.source && (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "0.1rem 0.4rem",
                      borderRadius: "3px",
                      background: "var(--surface-2, #333)",
                      opacity: 0.8,
                    }}
                    title={skill.sourceRef ?? undefined}
                  >
                    {skill.source}
                  </span>
                )}
                <span className="meta-value" style={{ flex: 1 }}>{skill.description}</span>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={(e) => updateSkill({ id: skill._id, enabled: e.target.checked })}
                  />
                  Enabled
                </label>
                {skill.sourceUrl && (
                  <button
                    className="btn btn-sm"
                    disabled={updatingSkillId === skill._id}
                    onClick={async () => {
                      setUpdatingSkillId(skill._id);
                      setUpdateSkillError(null);
                      try {
                        await updateSkillFromSource({ id: skill._id });
                      } catch (err) {
                        setUpdateSkillError({ id: skill._id, message: err instanceof Error ? err.message : String(err) });
                      } finally {
                        setUpdatingSkillId(null);
                      }
                    }}
                  >
                    {updatingSkillId === skill._id ? "Updating..." : "Update"}
                  </button>
                )}
                {!skill.sourceRef && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setEditingSkillId(skill._id);
                      setEditSkillForm({
                        name: skill.name,
                        description: skill.description,
                        content: skill.content,
                      });
                    }}
                  >
                    Edit
                  </button>
                )}
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    if (window.confirm(`Delete skill "${skill.name}"?`)) {
                      void removeSkill({ id: skill._id });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            )}
            {updateSkillError?.id === skill._id && (
              <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>{updateSkillError.message}</p>
            )}
          </div>
        ))}
      </section>

      <PromptTemplatesSection projectId={projectId} />

      <IssueTemplatesSection projectId={projectId} />

      <RecurrenceRulesSection projectId={projectId} />

      <section className="settings-section">
        <h2>
          Webhooks
          <button className="btn btn-sm" onClick={() => setShowAddWebhook(!showAddWebhook)}>
            + Add
          </button>
        </h2>
        {webhooks.map((wh) => (
          <div key={wh._id}>
            {editingWebhookId === wh._id ? (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await updateWebhook({
                    id: wh._id,
                    url: editWebhookForm.url,
                    events: editWebhookForm.events,
                    secret: editWebhookForm.secret || undefined,
                  });
                  setEditingWebhookId(null);
                }}
              >
                <input
                  placeholder="Webhook URL"
                  value={editWebhookForm.url}
                  onChange={(e) => setEditWebhookForm({ ...editWebhookForm, url: e.target.value })}
                  autoComplete="off"
                />
                <input
                  placeholder="Secret (optional, leave blank to keep)"
                  value={editWebhookForm.secret}
                  onChange={(e) => setEditWebhookForm({ ...editWebhookForm, secret: e.target.value })}
                  autoComplete="off"
                />
                <div className="webhook-events">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label key={event} className="toggle-label">
                      <input
                        type="checkbox"
                        checked={editWebhookForm.events.includes(event)}
                        onChange={(e) => {
                          const events = e.target.checked
                            ? [...editWebhookForm.events, event]
                            : editWebhookForm.events.filter((ev) => ev !== event);
                          setEditWebhookForm({ ...editWebhookForm, events });
                        }}
                      />
                      {event}
                    </label>
                  ))}
                </div>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setEditingWebhookId(null)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="settings-row">
                <span>{wh.url}</span>
                <span className="meta-value">{wh.events.join(", ")}</span>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={wh.enabled}
                    onChange={(e) =>
                      updateWebhook({ id: wh._id, enabled: e.target.checked })
                    }
                  />
                  Enabled
                </label>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditingWebhookId(wh._id);
                    setEditWebhookForm({
                      url: wh.url,
                      secret: "",
                      events: [...wh.events],
                    });
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => removeWebhook({ id: wh._id })}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
        {showAddWebhook && (
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await createWebhook({
                projectId,
                url: webhookForm.url,
                events: webhookForm.events,
                secret: webhookForm.secret || undefined,
              });
              setWebhookForm({ url: "", secret: "", events: [...WEBHOOK_EVENTS] });
              setShowAddWebhook(false);
            }}
          >
            <input
              placeholder="Webhook URL"
              value={webhookForm.url}
              onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
              autoComplete="off"
            />
            <input
              placeholder="Secret (optional)"
              value={webhookForm.secret}
              onChange={(e) => setWebhookForm({ ...webhookForm, secret: e.target.value })}
              autoComplete="off"
            />
            <div className="webhook-events">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="toggle-label">
                  <input
                    type="checkbox"
                    checked={webhookForm.events.includes(event)}
                    onChange={(e) => {
                      const events = e.target.checked
                        ? [...webhookForm.events, event]
                        : webhookForm.events.filter((ev) => ev !== event);
                      setWebhookForm({ ...webhookForm, events });
                    }}
                  />
                  {event}
                </label>
              ))}
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              Add
            </button>
          </form>
        )}

        <WebhookDeliveriesSection projectId={projectId} />
      </section>

      <section
        className="settings-section"
        style={{
          border: "1px solid #ef4444",
          borderRadius: "8px",
          padding: "1rem",
          marginTop: "2rem",
        }}
      >
        <h2 style={{ color: "#ef4444" }}>Danger Zone</h2>
        {!showDeleteProject ? (
          <div className="settings-row">
            <span>Permanently delete this project and all its data.</span>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setShowDeleteProject(true)}
            >
              Delete Project
            </button>
          </div>
        ) : (
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
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
              <button
                className="btn btn-sm btn-danger"
                disabled={deleteConfirmName !== project.name}
                onClick={async () => {
                  await removeProject({ id: projectId });
                }}
              >
                Confirm Delete
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setShowDeleteProject(false);
                  setDeleteConfirmName("");
                }}
              >
                Cancel
              </button>
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
