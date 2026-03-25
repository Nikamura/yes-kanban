import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LogStream } from "./LogStream";
import { DiffViewer } from "./DiffViewer";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RETRYABLE_STATUSES, CANCELLABLE_STATUSES, TERMINAL_STATUSES } from "../utils/constants";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { Textarea } from "@/ui/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";
import { cn } from "@/ui/lib/utils";
import { wsRunAttemptStatusClass, wsWorkspaceStatusClass } from "@/ui/lib/wsUi";

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
  const removeWorkspace = useMutation(api.workspaces.remove);
  const abandonWorkspace = useMutation(api.workspaces.abandon);
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
  const canRebase = ["pr_open", "completed", "conflict", "changes_requested", "merge_failed"].includes(workspace.status) &&
    ((workspace.behindMainBy ?? 0) > 0 || workspace.status === "conflict" || workspace.status === "merge_failed") &&
    workspace.worktrees.length > 0;
  const canCreatePR = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0 && hasChanges;
  const canMerge = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0 && hasChanges;
  const canApprovePlan = workspace.status === "awaiting_feedback" && workspace.plan;
  const canReplan = workspace.status === "awaiting_feedback" || workspace.status === "waiting_for_answer";
  const canRestartExperiment = ["completed", "failed", "changes_requested", "test_failed"].includes(workspace.status);
  const canRequestReview = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0 && hasChanges;
  const canRequestChanges = ["completed", "changes_requested"].includes(workspace.status) && workspace.worktrees.length > 0;
  const canDismissFeedback = workspace.status === "changes_requested" && !!workspace.reviewFeedback;
  const canDeleteWorkspace =
    TERMINAL_STATUSES.includes(workspace.status) && workspace.worktrees.length === 0;
  const deleteDisabledByWorktrees =
    TERMINAL_STATUSES.includes(workspace.status) && workspace.worktrees.length > 0;

  const pendingQuestions = questions?.filter((q) => q.status === "pending") ?? [];
  const hasQuestions = pendingQuestions.length > 0;
  const pendingPermissions = pendingPermissionRequests ?? [];
  const hasPendingPermissions = pendingPermissions.length > 0;

  const totalTokens = workspace.runAttempts.reduce((sum: number, a: any) => {
    return sum + (Number(a.tokenUsage?.totalTokens) || 0);
  }, 0);

  const effectiveTab =
    activeTab ?? (workspace.status === "awaiting_feedback" || workspace.status === "waiting_for_answer" ? "plan" : "logs");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[calc(100vh-80px)] w-[95vw] max-w-[1200px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        data-testid="workspace-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span
              className={wsWorkspaceStatusClass(workspace.status)}
              data-testid="ws-status"
              data-status={workspace.status}
            >
              {workspace.status === "awaiting_feedback"
                ? "awaiting feedback"
                : workspace.status === "waiting_for_answer"
                  ? "waiting for answer"
                  : workspace.status === "changes_requested"
                    ? "changes requested"
                    : workspace.status === "plan_reviewing"
                      ? "plan reviewing"
                      : workspace.status === "grilling"
                        ? "grilling"
                        : workspace.status}
            </span>
            {workspace.experimentNumber && workspace.experimentNumber > 0 && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                Exp #{workspace.experimentNumber}
              </Badge>
            )}
            {workspace.cancelRequested && (
              <span className={cn(wsWorkspaceStatusClass("cancelled"), "normal-case")}>cancel pending</span>
            )}
            {workspace.lastError && ["failed", "merge_failed", "test_failed"].includes(workspace.status) && (
              <span className="max-w-[min(100%,280px)] truncate text-xs text-destructive" title={workspace.lastError}>
                {workspace.lastError.length > 80 ? `${workspace.lastError.slice(0, 80)}…` : workspace.lastError}
              </span>
            )}
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {new Date(workspace.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {canApprovePlan && (
              <Button
                size="sm"
                onClick={() => approvePlan({ id: workspaceId })}
                title="Approve the plan and start implementation"
              >
                Approve Plan
              </Button>
            )}
            {canReplan && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => requestPlanning({ id: workspaceId })}
                title="Re-run planning with updated questions"
              >
                Re-plan
              </Button>
            )}
            {canRestartExperiment && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => restartExperiment({ id: workspaceId })}
                title="Discard changes and start a new experiment"
              >
                New Experiment
              </Button>
            )}
            {canRequestReview && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setActionError(null);
                  requestReview({ id: workspaceId }).catch((e: unknown) =>
                    setActionError(e instanceof Error ? e.message : "Failed to request review"),
                  );
                }}
                title="Re-run review on current changes"
              >
                Review
              </Button>
            )}
            {canRequestChanges && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowChangesInput(!showChangesInput)}
                title="Request additional changes from the agent"
              >
                Request Changes
              </Button>
            )}
            {canCreatePR && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setActionError(null);
                  requestCreatePR({ id: workspaceId }).catch((e: unknown) =>
                    setActionError(e instanceof Error ? e.message : "Failed to create PR"),
                  );
                }}
                title="Push branch and create pull request"
              >
                Create PR
              </Button>
            )}
            {canMerge && (
              <Button
                size="sm"
                onClick={() => {
                  setActionError(null);
                  requestLocalMerge({ id: workspaceId }).catch((e: unknown) =>
                    setActionError(e instanceof Error ? e.message : "Failed to merge"),
                  );
                }}
                title="Merge branch locally into base branch"
              >
                Merge
              </Button>
            )}
            {canRebase && (
              <Button size="sm" variant="outline" onClick={() => requestRebase({ id: workspaceId })} title={`${workspace.behindMainBy} commit(s) behind main`}>
                Rebase ↓{workspace.behindMainBy}
              </Button>
            )}
            {canRetry && (
              <Button size="sm" onClick={() => retryWorkspace({ id: workspaceId })}>
                Retry
              </Button>
            )}
            {canDismissFeedback && (
              <Button size="sm" variant="outline" onClick={() => dismissFeedback({ id: workspaceId })}>
                Dismiss
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="destructive" onClick={() => requestCancel({ id: workspaceId })}>
                Cancel
              </Button>
            )}
            {canDeleteWorkspace && (
              <Button
                size="sm"
                variant="destructive"
                title="Delete this workspace permanently"
                onClick={() => {
                  if (!window.confirm("Delete this workspace? This cannot be undone.")) {
                    return;
                  }
                  setActionError(null);
                  void removeWorkspace({ id: workspaceId })
                    .then(() => onClose())
                    .catch((e: unknown) =>
                      setActionError(e instanceof Error ? e.message : "Failed to delete workspace"),
                    );
                }}
              >
                Delete
              </Button>
            )}
            {deleteDisabledByWorktrees && (
              <Button
                size="sm"
                variant="destructive"
                title="Stop using this workspace and queue worktree cleanup"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Abandon this workspace? Its worktrees will be removed by the worker; you can delete the record afterward.",
                    )
                  ) {
                    return;
                  }
                  setActionError(null);
                  void abandonWorkspace({ id: workspaceId }).catch((e: unknown) =>
                    setActionError(e instanceof Error ? e.message : "Failed to abandon workspace"),
                  );
                }}
              >
                Abandon
              </Button>
            )}
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onClose} aria-label="Close workspace">
              &times;
            </Button>
          </div>
        </div>

        {actionError && (
          <div className="flex items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {actionError}
            <Button variant="ghost" size="sm" className="h-7 px-2" aria-label="Dismiss error" onClick={() => setActionError(null)}>
              &times;
            </Button>
          </div>
        )}

        {showChangesInput && (
          <div className="border-b border-border bg-muted/30 px-3 py-3">
            <Textarea
              className="min-h-[72px] text-sm"
              placeholder="Describe what changes you'd like..."
              value={changesText}
              onChange={(e) => setChangesText(e.target.value)}
              rows={3}
              autoComplete="off"
              autoFocus
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!changesText.trim()}
                onClick={() => {
                  setActionError(null);
                  requestChanges({ id: workspaceId, instructions: changesText.trim() })
                    .then(() => {
                      setShowChangesInput(false);
                      setChangesText("");
                    })
                    .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Failed to request changes"));
                }}
              >
                Submit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowChangesInput(false);
                  setChangesText("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <Tabs
          value={effectiveTab}
          onValueChange={(v) => setActiveTab(v as "logs" | "plan" | "diff" | "details")}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <TabsList variant="line" className="h-auto w-full shrink-0 justify-start rounded-none border-b border-border bg-transparent px-2 pt-1">
            <TabsTrigger value="logs" data-testid="ws-tab-logs">
              Logs
            </TabsTrigger>
            <TabsTrigger value="plan" data-testid="ws-tab-plan">
              Plan{hasQuestions ? ` (${pendingQuestions.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="diff" data-testid="ws-tab-diff">
              Diff
            </TabsTrigger>
            <TabsTrigger value="details" data-testid="ws-tab-details">
              Details
            </TabsTrigger>
          </TabsList>

          {hasPendingPermissions && (
            <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-3 dark:bg-amber-950/30">
              <h4 className="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                Permission Requests ({pendingPermissions.length})
              </h4>
              {pendingPermissions.map((pr) => (
                <div key={pr._id} className="mb-3 rounded-md border border-amber-500/25 bg-card p-3 last:mb-0">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-sm font-semibold text-foreground">{pr.toolName}</span>
                      {pr.toolInput && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded-sm bg-muted p-2 font-mono text-[11px] text-foreground">
                          {pr.toolInput.length > 500 ? `${pr.toolInput.slice(0, 500)}...` : pr.toolInput}
                        </pre>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setActionError(null);
                          void respondPermission({ id: pr._id, status: "approved" }).catch((e: unknown) =>
                            setActionError(e instanceof Error ? e.message : "Failed to approve permission"),
                          );
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const risky = /^(Bash|Write|NotebookEdit)$/i.test(pr.toolName);
                          if (
                            risky &&
                            !window.confirm(
                              `"${pr.toolName}" can modify files and run commands. Always allow this tool for all future runs of this agent config?`,
                            )
                          )
                            {return;}
                          setActionError(null);
                          void respondPermission({ id: pr._id, status: "always_allowed" }).catch((e: unknown) =>
                            setActionError(e instanceof Error ? e.message : "Failed to update permission rule"),
                          );
                        }}
                      >
                        Always Allow
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setActionError(null);
                          void respondPermission({ id: pr._id, status: "rejected" }).catch((e: unknown) =>
                            setActionError(e instanceof Error ? e.message : "Failed to reject permission"),
                          );
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <TabsContent value="logs" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
            {workspace.runAttempts.length > 1 && (
              <div className="flex shrink-0 flex-wrap gap-1 border-b border-border bg-muted/20 px-2 py-2">
                {workspace.runAttempts.map((ra: any) => (
                  <button
                    key={ra._id}
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 font-mono text-[11px] transition-colors",
                      displayAttempt?._id === ra._id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "bg-card hover:bg-muted",
                    )}
                    onClick={() => setSelectedAttemptId(ra._id)}
                    title={[ra.agentConfig?.name, ra.agentConfig?.model].filter(Boolean).join(" · ") || undefined}
                  >
                    <span>#{ra.attemptNumber}</span>
                    <span className="text-muted-foreground">{ra.type}</span>
                    <span className={wsRunAttemptStatusClass(ra.status)}>
                      {ra.status === "running"
                        ? "●"
                        : ra.status === "succeeded"
                          ? "✓"
                          : ra.status === "failed"
                            ? "✗"
                            : ra.status === "abandoned"
                              ? "⊘"
                              : "○"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {displayAttempt && (
              <LogStream
                runAttemptId={displayAttempt._id}
                prompt={displayAttempt.prompt}
                agentType={displayAttempt.agentConfig?.agentType ?? workspace.agentConfig?.agentType}
              />
            )}
            {!displayAttempt && (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
                No run attempts yet
              </div>
            )}
          </TabsContent>

          <TabsContent value="plan" className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
            <div className="flex flex-col gap-6 p-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">Implementation Plan</h3>
                  {workspace.plan && !editingPlan && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPlanDraft(workspace.plan ?? "");
                        setEditingPlan(true);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                </div>
                {workspace.plan && !editingPlan && (
                  <div>
                    <div className="prose-log text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{workspace.plan}</ReactMarkdown>
                    </div>
                    {workspace.planApproved && (
                      <span className="mt-2 inline-block rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                        Approved
                      </span>
                    )}
                  </div>
                )}
                {editingPlan && (
                  <div>
                    <Textarea
                      value={planDraft}
                      onChange={(e) => setPlanDraft(e.target.value)}
                      rows={12}
                      autoComplete="off"
                      className="font-mono text-sm"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          void updatePlan({ id: workspaceId, plan: planDraft });
                          setEditingPlan(false);
                        }}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingPlan(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {!workspace.plan && (
                  <div className="py-6 text-center text-muted-foreground">
                    {workspace.status === "grilling"
                      ? "Agent is interviewing you before planning..."
                      : workspace.status === "planning"
                        ? "Agent is creating a plan..."
                        : workspace.status === "plan_reviewing"
                          ? "AI is reviewing the plan..."
                          : "No plan yet"}
                  </div>
                )}
              </div>

              {questions && questions.length > 0 && (
                <div>
                  <h3 className="mb-3 text-base font-semibold">Agent Questions</h3>
                  {questions.map((q) => (
                    <div
                      key={q._id}
                      className="mb-4 rounded-md border border-border bg-card p-3"
                      data-testid="ws-question"
                      data-status={q.status}
                    >
                      <div className="prose-log text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.question}</ReactMarkdown>
                      </div>
                      {q.status === "pending" && (
                        <div className="mt-3 space-y-3" data-testid="ws-question-answer-form">
                          {q.suggestedAnswers && q.suggestedAnswers.length > 0 && (
                            <div className="flex flex-col gap-2">
                              {q.suggestedAnswers.map((suggestion, i) => (
                                <Button
                                  key={i}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-auto justify-start whitespace-normal text-left font-normal"
                                  data-testid="ws-question-suggestion"
                                  onClick={() => setAnswerDrafts((prev) => ({ ...prev, [q._id]: suggestion }))}
                                >
                                  {suggestion}
                                </Button>
                              ))}
                              <div className="text-center text-xs text-muted-foreground">— or type a custom answer —</div>
                            </div>
                          )}
                          <Textarea
                            data-testid="ws-question-input"
                            placeholder="Type your answer..."
                            value={answerDrafts[q._id] ?? ""}
                            onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [q._id]: e.target.value }))}
                            rows={2}
                            autoComplete="off"
                            className="text-sm"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={!(answerDrafts[q._id] ?? "").trim()}
                              onClick={() => {
                                const answer = answerDrafts[q._id] ?? "";
                                if (answer.trim()) {
                                  void answerQuestion({ id: q._id, answer: answer.trim() });
                                  setAnswerDrafts((prev) =>
                                    Object.fromEntries(Object.entries(prev).filter(([k]) => k !== q._id)),
                                  );
                                }
                              }}
                            >
                              Answer
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => dismissQuestion({ id: q._id })}>
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      )}
                      {q.status === "answered" && q.answer && (
                        <div className="prose-log mt-3 border-t border-border pt-3 text-sm">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{`**A:** ${q.answer}`}</ReactMarkdown>
                        </div>
                      )}
                      {q.status === "dismissed" && (
                        <div className="mt-2 text-xs font-medium text-muted-foreground">Dismissed</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div>
                <h3 className="mb-2 text-base font-semibold">Feedback</h3>
                {feedbackMessages && feedbackMessages.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {feedbackMessages.map((m) => (
                      <div
                        key={m._id}
                        className={cn(
                          "rounded-md border border-border px-3 py-2 text-sm",
                          m.author === "user" ? "bg-muted/50" : "bg-secondary/80",
                        )}
                      >
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{m.author}</span>
                        <span className="ml-2 text-foreground">{m.body}</span>
                        <span
                          className={cn(
                            "ml-2 font-mono text-[10px]",
                            m.status === "delivered" ? "text-emerald-600" : "text-amber-600",
                          )}
                        >
                          {m.status === "delivered" ? "delivered" : "pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Textarea
                    placeholder="Send feedback to the agent..."
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    rows={2}
                    autoComplete="off"
                    className="min-h-[60px] flex-1 text-sm"
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
                  <Button
                    size="sm"
                    className="shrink-0"
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
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="diff" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            {workspace.worktrees.length > 0 ? (
              <DiffViewer worktrees={workspace.worktrees} diffOutput={workspace.diffOutput} />
            ) : (
              <div className="p-6 text-center text-muted-foreground">No worktrees</div>
            )}
          </TabsContent>

          <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
            <div className="space-y-6 p-4">
              <div>
                <h3 className="mb-2 text-base font-semibold">Agent Configuration</h3>
                {workspace.agentConfig && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Name</label>
                      <span className="block text-sm">{workspace.agentConfig.name}</span>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Type</label>
                      <span className="block text-sm">{workspace.agentConfig.agentType}</span>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">Command</label>
                      <span className="block font-mono text-sm">{workspace.agentConfig.command}</span>
                    </div>
                    {workspace.agentConfig.model && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Model</label>
                        <span className="block text-sm">{workspace.agentConfig.model}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-base font-semibold">Worktrees</h3>
                {workspace.worktrees.map((wt: any, i: number) => (
                  <div key={i} className="mb-3 rounded-md border border-border bg-secondary/30 p-3 last:mb-0">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Branch</label>
                        <code className="mt-0.5 block font-mono text-xs">{wt.branchName}</code>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Base</label>
                        <code className="mt-0.5 block font-mono text-xs">{wt.baseBranch}</code>
                      </div>
                      <div className="sm:col-span-3">
                        <label className="text-xs text-muted-foreground">Path</label>
                        <code className="mt-0.5 block break-all font-mono text-xs">{wt.worktreePath}</code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <h3 className="mb-2 text-base font-semibold">Run Attempts ({workspace.runAttempts.length})</h3>
                <p className="mb-3 text-sm text-muted-foreground">Total tokens: {totalTokens.toLocaleString()}</p>
                {workspace.runAttempts.map((ra: any) => (
                  <div key={ra._id} className="mb-3 rounded-md border border-border p-3 last:mb-0">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="font-semibold">#{ra.attemptNumber}</span>
                      <span className={wsWorkspaceStatusClass(ra.status)}>{ra.status}</span>
                      <span className="text-muted-foreground">{ra.type}</span>
                      {ra.exitCode !== undefined && (
                        <span className="font-mono text-[11px] text-muted-foreground">exit: {ra.exitCode}</span>
                      )}
                      {ra.tokenUsage && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {ra.tokenUsage.totalTokens.toLocaleString()} tokens
                        </span>
                      )}
                    </div>
                    {ra.error && <div className="mt-2 text-sm text-destructive">{ra.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
