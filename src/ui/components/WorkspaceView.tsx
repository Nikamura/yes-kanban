import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LogStream } from "./LogStream";
import { DiffViewer } from "./DiffViewer";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RETRYABLE_STATUSES, CANCELLABLE_STATUSES } from "../utils/constants";

export function WorkspaceView({
  workspaceId,
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  onClose: () => void;
}) {
  const workspace = useQuery(api.workspaces.get, { id: workspaceId });
  const questions = useQuery(api.agentQuestions.list, { workspaceId });
  const feedbackMessages = useQuery(api.feedbackMessages.list, { workspaceId });
  const retryWorkspace = useMutation(api.workspaces.retry);
  const requestCancel = useMutation(api.workspaces.requestCancel);
  const requestRebase = useMutation(api.workspaces.requestRebase);
  const requestCreatePR = useMutation(api.workspaces.requestCreatePR);
  const requestLocalMerge = useMutation(api.workspaces.requestLocalMerge);
  const approvePlan = useMutation(api.workspaces.approvePlan);
  const requestPlanning = useMutation(api.workspaces.requestPlanning);
  const restartExperiment = useMutation(api.workspaces.restartExperiment);
  const requestReview = useMutation(api.workspaces.requestReview);
  const requestChanges = useMutation(api.workspaces.requestChanges);
  const dismissFeedback = useMutation(api.workspaces.dismissReviewFeedback);
  const updatePlan = useMutation(api.workspaces.updatePlan);
  const answerQuestion = useMutation(api.agentQuestions.answer);
  const dismissQuestion = useMutation(api.agentQuestions.dismiss);
  const sendFeedback = useMutation(api.feedbackMessages.create);
  const pendingPermissionRequests = useQuery(api.permissionRequests.listPending, { workspaceId });
  const respondPermission = useMutation(api.permissionRequests.respond);
  const [activeTab, setActiveTab] = useState<"logs" | "plan" | "diff" | "details" | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<Id<"runAttempts"> | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [showChangesInput, setShowChangesInput] = useState(false);
  const [changesText, setChangesText] = useState("");

  if (!workspace) return null;

  const activeAttempt = workspace.runAttempts.find((a: any) => a.status === "running");
  const latestAttempt = workspace.runAttempts[workspace.runAttempts.length - 1];
  const displayAttempt = selectedAttemptId
    ? workspace.runAttempts.find((a: any) => a._id === selectedAttemptId) ?? (activeAttempt ?? latestAttempt)
    : (activeAttempt ?? latestAttempt);

  const canRetry = RETRYABLE_STATUSES.includes(workspace.status);
  const canCancel = CANCELLABLE_STATUSES.includes(workspace.status) && !workspace.cancelRequested;
  const hasChanges = !!workspace.diffOutput;
  const canRebase = ["pr_open", "completed", "conflict", "changes_requested"].includes(workspace.status) &&
    ((workspace.behindMainBy ?? 0) > 0 || workspace.status === "conflict") && workspace.worktrees.length > 0;
  const canCreatePR = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0 && hasChanges;
  const canMerge = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0 && hasChanges;
  const canApprovePlan = workspace.status === "awaiting_feedback" && workspace.plan;
  const canReplan = workspace.status === "awaiting_feedback";
  const canRestartExperiment = ["completed", "failed", "changes_requested", "test_failed"].includes(workspace.status);
  const canRequestReview = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0 && hasChanges;
  const canRequestChanges = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0;
  const canDismissFeedback = workspace.status === "changes_requested" && !!workspace.reviewFeedback;

  const pendingQuestions = questions?.filter((q) => q.status === "pending") ?? [];
  const hasQuestions = pendingQuestions.length > 0;
  const pendingPermissions = pendingPermissionRequests ?? [];
  const hasPendingPermissions = pendingPermissions.length > 0;

  const totalTokens = workspace.runAttempts.reduce((sum: number, a: any) => {
    return sum + (Number(a.tokenUsage?.totalTokens) || 0);
  }, 0);

  // Default to plan tab when awaiting feedback, otherwise logs. User can override by clicking tabs.
  const effectiveTab = activeTab ?? (workspace.status === "awaiting_feedback" ? "plan" : "logs");

  return (
    <div className="panel-overlay workspace-overlay" onClick={onClose}>
      <div className="workspace-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="ws-header-info">
            <span className={`ws-status ws-status-${workspace.status}`}>
              {workspace.status === "awaiting_feedback" ? "awaiting feedback" : workspace.status === "changes_requested" ? "changes requested" : workspace.status === "plan_reviewing" ? "plan reviewing" : workspace.status}
            </span>
            {workspace.experimentNumber && workspace.experimentNumber > 0 && (
              <span className="ws-experiment-badge">
                Exp #{workspace.experimentNumber}
              </span>
            )}
            {workspace.cancelRequested && (
              <span className="ws-status ws-status-cancelled">cancel pending</span>
            )}
            <span className="ws-date">
              {new Date(workspace.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="ws-header-actions">
            {canApprovePlan && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => approvePlan({ id: workspaceId })}
                title="Approve the plan and start implementation"
              >
                Approve Plan
              </button>
            )}
            {canReplan && (
              <button
                className="btn btn-sm"
                onClick={() => requestPlanning({ id: workspaceId })}
                title="Re-run planning with updated questions"
              >
                Re-plan
              </button>
            )}
            {canRestartExperiment && (
              <button
                className="btn btn-sm"
                onClick={() => restartExperiment({ id: workspaceId })}
                title="Discard changes and start a new experiment"
              >
                New Experiment
              </button>
            )}
            {canRequestReview && (
              <button
                className="btn btn-sm"
                onClick={() => { setActionError(null); requestReview({ id: workspaceId }).catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Failed to request review")); }}
                title="Re-run review on current changes"
              >
                Review
              </button>
            )}
            {canRequestChanges && (
              <button
                className="btn btn-sm"
                onClick={() => setShowChangesInput(!showChangesInput)}
                title="Request additional changes from the agent"
              >
                Request Changes
              </button>
            )}
            {canCreatePR && (
              <button
                className="btn btn-sm"
                onClick={() => { setActionError(null); requestCreatePR({ id: workspaceId }).catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Failed to create PR")); }}
                title="Push branch and create pull request"
              >
                Create PR
              </button>
            )}
            {canMerge && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setActionError(null); requestLocalMerge({ id: workspaceId }).catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Failed to merge")); }}
                title="Merge branch locally into base branch"
              >
                Merge
              </button>
            )}
            {canRebase && (
              <button
                className="btn btn-sm"
                onClick={() => requestRebase({ id: workspaceId })}
                title={`${workspace.behindMainBy} commit(s) behind main`}
              >
                Rebase ↓{workspace.behindMainBy}
              </button>
            )}
            {canRetry && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => retryWorkspace({ id: workspaceId })}
              >
                Retry
              </button>
            )}
            {canDismissFeedback && (
              <button
                className="btn btn-sm"
                onClick={() => dismissFeedback({ id: workspaceId })}
              >
                Dismiss
              </button>
            )}
            {canCancel && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => requestCancel({ id: workspaceId })}
              >
                Cancel
              </button>
            )}
            <button className="close-btn" onClick={onClose}>
              &times;
            </button>
          </div>
        </div>

        {actionError && (
          <div className="ws-error-banner" role="alert">
            {actionError}
            <button className="btn btn-sm" aria-label="Dismiss error" onClick={() => setActionError(null)}>&times;</button>
          </div>
        )}

        {showChangesInput && (
          <div className="ws-changes-input">
            <textarea
              className="ws-changes-textarea"
              placeholder="Describe what changes you'd like..."
              value={changesText}
              onChange={(e) => setChangesText(e.target.value)}
              rows={3}
              autoComplete="off"
              autoFocus
            />
            <div className="ws-changes-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={!changesText.trim()}
                onClick={() => {
                  setActionError(null);
                  requestChanges({ id: workspaceId, instructions: changesText.trim() })
                    .then(() => { setShowChangesInput(false); setChangesText(""); })
                    .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Failed to request changes"));
                }}
              >
                Submit
              </button>
              <button
                className="btn btn-sm"
                onClick={() => { setShowChangesInput(false); setChangesText(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="ws-tabs">
          <button
            className={`ws-tab ${effectiveTab === "logs" ? "active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            Logs
          </button>
          <button
            className={`ws-tab ${effectiveTab === "plan" ? "active" : ""}`}
            onClick={() => setActiveTab("plan")}
          >
            Plan{hasQuestions ? ` (${pendingQuestions.length})` : ""}
          </button>
          <button
            className={`ws-tab ${effectiveTab === "diff" ? "active" : ""}`}
            onClick={() => setActiveTab("diff")}
          >
            Diff
          </button>
          <button
            className={`ws-tab ${effectiveTab === "details" ? "active" : ""}`}
            onClick={() => setActiveTab("details")}
          >
            Details
          </button>
        </div>

        {hasPendingPermissions && (
          <div className="ws-permission-banner">
            <h4>Permission Requests ({pendingPermissions.length})</h4>
            {pendingPermissions.map((pr) => (
              <div key={pr._id} className="ws-permission-request">
                <div className="ws-permission-info">
                  <span className="ws-permission-tool">{pr.toolName}</span>
                  {pr.toolInput && (
                    <pre className="ws-permission-input">{pr.toolInput.length > 500 ? pr.toolInput.slice(0, 500) + "..." : pr.toolInput}</pre>
                  )}
                </div>
                <div className="ws-permission-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => respondPermission({ id: pr._id, status: "approved" }).catch(() => {})}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const risky = /^(Bash|Write|NotebookEdit)$/i.test(pr.toolName);
                      if (risky && !window.confirm(`"${pr.toolName}" can modify files and run commands. Always allow this tool for all future runs of this agent config?`)) return;
                      respondPermission({ id: pr._id, status: "always_allowed" }).catch(() => {});
                    }}
                  >
                    Always Allow
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => respondPermission({ id: pr._id, status: "rejected" }).catch(() => {})}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="ws-content">
          {effectiveTab === "logs" && workspace.runAttempts.length > 1 && (
            <div className="ws-run-selector">
              {workspace.runAttempts.map((ra: any) => (
                <button
                  key={ra._id}
                  className={`ws-run-btn ${displayAttempt?._id === ra._id ? "active" : ""}`}
                  onClick={() => setSelectedAttemptId(ra._id)}
                >
                  <span className="ws-run-btn-num">#{ra.attemptNumber}</span>
                  <span className="ws-run-btn-type">{ra.type}</span>
                  <span className={`ws-run-btn-status ws-status-${ra.status}`}>
                    {ra.status === "running" ? "●" : ra.status === "succeeded" ? "✓" : ra.status === "failed" ? "✗" : ra.status === "abandoned" ? "⊘" : "○"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {effectiveTab === "logs" && displayAttempt && (
            <LogStream runAttemptId={displayAttempt._id} prompt={displayAttempt.prompt} />
          )}
          {effectiveTab === "logs" && !displayAttempt && (
            <div className="empty-state">No run attempts yet</div>
          )}

          {effectiveTab === "plan" && (
            <div className="ws-plan-view">
              {/* Plan section */}
              <div className="ws-plan-section">
                <div className="ws-plan-header">
                  <h3>Implementation Plan</h3>
                  {workspace.plan && !editingPlan && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setPlanDraft(workspace.plan ?? "");
                        setEditingPlan(true);
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
                {workspace.plan && !editingPlan && (
                  <div className="ws-plan-content">
                    <div className="ws-plan-text markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{workspace.plan}</ReactMarkdown>
                    </div>
                    {workspace.planApproved && (
                      <span className="ws-plan-approved">Approved</span>
                    )}
                  </div>
                )}
                {editingPlan && (
                  <div className="ws-plan-editor">
                    <textarea
                      className="ws-plan-textarea"
                      value={planDraft}
                      onChange={(e) => setPlanDraft(e.target.value)}
                      rows={12}
                      autoComplete="off"
                    />
                    <div className="ws-plan-editor-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          void updatePlan({ id: workspaceId, plan: planDraft });
                          setEditingPlan(false);
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setEditingPlan(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!workspace.plan && (
                  <div className="empty-state">
                    {workspace.status === "planning" ? "Agent is creating a plan..." : workspace.status === "plan_reviewing" ? "AI is reviewing the plan..." : "No plan yet"}
                  </div>
                )}
              </div>

              {/* Questions section */}
              {questions && questions.length > 0 && (
                <div className="ws-questions-section">
                  <h3>Agent Questions</h3>
                  {questions.map((q) => (
                    <div key={q._id} className={`ws-question ${q.status}`}>
                      <div className="ws-question-text log-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.question}</ReactMarkdown>
                      </div>
                      {q.status === "pending" && (
                        <div className="ws-question-answer-form">
                          {q.suggestedAnswers && q.suggestedAnswers.length > 0 && (
                            <div className="ws-question-suggestions">
                              {q.suggestedAnswers.map((suggestion, i) => (
                                <button
                                  key={i}
                                  className="btn btn-sm ws-question-suggestion"
                                  onClick={() => void answerQuestion({ id: q._id, answer: suggestion })}
                                >
                                  {suggestion}
                                </button>
                              ))}
                              <div className="ws-question-or-divider">— or type a custom answer —</div>
                            </div>
                          )}
                          <textarea
                            className="ws-question-input"
                            placeholder="Type your answer..."
                            value={answerDrafts[q._id] ?? ""}
                            onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [q._id]: e.target.value }))}
                            rows={2}
                            autoComplete="off"
                          />
                          <div className="ws-question-actions">
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={!(answerDrafts[q._id] ?? "").trim()}
                              onClick={() => {
                                const answer = answerDrafts[q._id] ?? "";
                                if (answer.trim()) {
                                  void answerQuestion({ id: q._id, answer: answer.trim() });
                                  setAnswerDrafts((prev) =>
                                    Object.fromEntries(Object.entries(prev).filter(([k]) => k !== q._id))
                                  );
                                }
                              }}
                            >
                              Answer
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => dismissQuestion({ id: q._id })}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                      {q.status === "answered" && q.answer && (
                        <div className="ws-question-answered log-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{`**A:** ${q.answer}`}</ReactMarkdown>
                        </div>
                      )}
                      {q.status === "dismissed" && (
                        <div className="ws-question-dismissed">Dismissed</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Feedback section */}
              <div className="ws-feedback-section">
                <h3>Feedback</h3>
                {feedbackMessages && feedbackMessages.length > 0 && (
                  <div className="ws-feedback-messages">
                    {feedbackMessages.map((m) => (
                      <div key={m._id} className={`ws-feedback-msg ws-feedback-${m.author}`}>
                        <span className="ws-feedback-author">{m.author}</span>
                        <span className="ws-feedback-body">{m.body}</span>
                        <span className={`ws-feedback-status ${m.status}`}>
                          {m.status === "delivered" ? "delivered" : "pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="ws-feedback-input">
                  <textarea
                    placeholder="Send feedback to the agent..."
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    rows={2}
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && feedbackText.trim()) {
                        void sendFeedback({
                          workspaceId,
                          body: feedbackText.trim(),
                        });
                        setFeedbackText("");
                      }
                    }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!feedbackText.trim()}
                    onClick={() => {
                      if (feedbackText.trim()) {
                        void sendFeedback({
                          workspaceId,
                          body: feedbackText.trim(),
                        });
                        setFeedbackText("");
                      }
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}

          {effectiveTab === "diff" && workspace.worktrees.length > 0 && (
            <DiffViewer
              worktrees={workspace.worktrees}
              diffOutput={workspace.diffOutput}
              fileTree={workspace.fileTree}
              workspaceId={workspaceId}
            />
          )}
          {effectiveTab === "details" && (
            <div className="ws-details">
              <div className="ws-detail-section">
                <h3>Agent Configuration</h3>
                {workspace.agentConfig && (
                  <div className="ws-detail-grid">
                    <div className="ws-detail-item">
                      <label>Name</label>
                      <span>{workspace.agentConfig.name}</span>
                    </div>
                    <div className="ws-detail-item">
                      <label>Type</label>
                      <span>{workspace.agentConfig.agentType}</span>
                    </div>
                    <div className="ws-detail-item">
                      <label>Command</label>
                      <span>{workspace.agentConfig.command}</span>
                    </div>
                    {workspace.agentConfig.model && (
                      <div className="ws-detail-item">
                        <label>Model</label>
                        <span>{workspace.agentConfig.model}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="ws-detail-section">
                <h3>Worktrees</h3>
                {workspace.worktrees.map((wt: any, i: number) => (
                  <div key={i} className="ws-worktree-entry">
                    <div>
                      <label>Branch</label>
                      <code>{wt.branchName}</code>
                    </div>
                    <div>
                      <label>Base</label>
                      <code>{wt.baseBranch}</code>
                    </div>
                    <div>
                      <label>Path</label>
                      <code>{wt.worktreePath}</code>
                    </div>
                  </div>
                ))}
              </div>

              <div className="ws-detail-section">
                <h3>Run Attempts ({workspace.runAttempts.length})</h3>
                <div className="ws-token-summary">
                  Total tokens: {totalTokens.toLocaleString()}
                </div>
                {workspace.runAttempts.map((ra: any) => (
                  <div key={ra._id} className="ws-attempt-entry">
                    <span className="ws-attempt-num">#{ra.attemptNumber}</span>
                    <span className={`ws-status ws-status-${ra.status}`}>
                      {ra.status}
                    </span>
                    <span className="ws-attempt-type">{ra.type}</span>
                    {ra.exitCode !== undefined && (
                      <span className="meta-value">exit: {ra.exitCode}</span>
                    )}
                    {ra.tokenUsage && (
                      <span className="meta-value">
                        {ra.tokenUsage.totalTokens.toLocaleString()} tokens
                      </span>
                    )}
                    {ra.error && (
                      <div className="ws-attempt-error">{ra.error}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
