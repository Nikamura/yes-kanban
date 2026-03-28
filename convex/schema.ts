import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    slug: v.string(),
    simpleIdPrefix: v.string(),
    simpleIdCounter: v.number(),
    defaultAgentConfigId: v.optional(v.id("agentConfigs")),
    planningAgentConfigId: v.optional(v.id("agentConfigs")),
    reviewAgentConfigId: v.optional(v.id("agentConfigs")),
    maxReviewCycles: v.number(),
    cleanupDelayMs: v.number(),
    autoArchiveDelayMs: v.optional(v.number()),
    mergePolicy: v.optional(v.union(v.string(), v.null())),
    skipReview: v.optional(v.boolean()),
    skipTests: v.optional(v.boolean()),
    skipPlanning: v.optional(v.boolean()),
    autoPlanReview: v.optional(v.boolean()),
    maxConcurrent: v.optional(v.union(v.number(), v.null())),
    maxConcurrentPlanning: v.optional(v.union(v.number(), v.null())),
    maxConcurrentCoding: v.optional(v.union(v.number(), v.null())),
    maxConcurrentTesting: v.optional(v.union(v.number(), v.null())),
    maxConcurrentReviewing: v.optional(v.union(v.number(), v.null())),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  columns: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
    position: v.number(),
    visible: v.boolean(),
    autoDispatch: v.boolean(),
    mergePolicy: v.optional(v.string()),
    skipReview: v.boolean(),
    skipTests: v.boolean(),
    skipPlanning: v.optional(v.boolean()),
    autoPlanReview: v.optional(v.boolean()),
    maxConcurrent: v.optional(v.number()),
  }).index("by_project", ["projectId"]),

  issues: defineTable({
    projectId: v.id("projects"),
    simpleId: v.string(),
    title: v.string(),
    description: v.string(),
    status: v.string(),
    tags: v.array(v.string()),
    blockedBy: v.optional(v.array(v.id("issues"))),
    deepResearch: v.optional(v.boolean()),
    grillMe: v.optional(v.boolean()),
    autoMerge: v.optional(v.boolean()),
    // TODO: remove after removeChecklistFromIssues migration runs
    checklist: v.optional(v.array(v.object({ id: v.string(), text: v.string(), completed: v.boolean() }))),
    archivedAt: v.optional(v.number()),
    position: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_project_archived", ["projectId", "archivedAt"]),

  repos: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.string(),
    path: v.string(),
    defaultBranch: v.string(),
    setupScript: v.optional(v.string()),
    beforeRunScript: v.optional(v.string()),
    afterRunScript: v.optional(v.string()),
    cleanupScript: v.optional(v.string()),
    scriptTimeoutMs: v.number(),
    testCommand: v.optional(v.string()),
    testTimeoutMs: v.number(),
  }).index("by_project", ["projectId"]),

  agentConfigs: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    agentType: v.string(),
    command: v.string(),
    args: v.array(v.string()),
    model: v.optional(v.string()),
    effort: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    timeoutMs: v.number(),
    maxRetries: v.number(),
    retryBackoffMs: v.number(),
    maxRetryBackoffMs: v.number(),
    env: v.optional(v.record(v.string(), v.string())),
    mcpEnabled: v.boolean(),
    mcpTools: v.optional(v.array(v.string())),
    permissionMode: v.optional(v.union(v.literal("bypass"), v.literal("accept"))),
    // TODO: remove after YES-255 `clearAllowedToolPatterns` migration has run
    allowedToolPatterns: v.optional(v.array(v.string())),
  }).index("by_project", ["projectId"]),

  workspaces: defineTable({
    issueId: v.optional(v.id("issues")),
    projectId: v.id("projects"),
    worktrees: v.array(
      v.object({
        repoId: v.id("repos"),
        repoPath: v.string(),
        baseBranch: v.string(),
        branchName: v.string(),
        worktreePath: v.string(),
      })
    ),
    status: v.string(),
    agentConfigId: v.id("agentConfigs"),
    agentCwd: v.string(),
    cancelRequested: v.optional(v.boolean()),
    diffOutput: v.optional(v.string()),
    behindMainBy: v.optional(v.number()),
    plan: v.optional(v.string()),
    planApproved: v.optional(v.boolean()),
    grillingComplete: v.optional(v.boolean()),
    experimentNumber: v.optional(v.number()),
    previousStatus: v.optional(v.string()),
    reviewFeedback: v.optional(v.string()),
    reviewRequested: v.optional(v.boolean()),
    lastError: v.optional(v.string()),
    sourceColumn: v.optional(v.string()),
    fileTree: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_issue", ["issueId"])
    .index("by_status", ["status"])
    .index("by_project", ["projectId"]),

  agentQuestions: defineTable({
    workspaceId: v.id("workspaces"),
    question: v.string(),
    suggestedAnswers: v.optional(v.array(v.string())),
    answer: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("answered"), v.literal("dismissed")),
    createdAt: v.number(),
    answeredAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  feedbackMessages: defineTable({
    workspaceId: v.id("workspaces"),
    body: v.string(),
    author: v.union(v.literal("user"), v.literal("system")),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("expired")),
    createdAt: v.number(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  permissionRequests: defineTable({
    workspaceId: v.id("workspaces"),
    runAttemptId: v.id("runAttempts"),
    toolName: v.string(),
    toolInput: v.optional(v.string()),
    requestId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("always_allowed"),
    ),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_run_attempt_status", ["runAttemptId", "status"])
    .index("by_run_attempt_request", ["runAttemptId", "requestId"]),

  runAttempts: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    agentConfigId: v.optional(v.id("agentConfigs")),
    type: v.string(),
    attemptNumber: v.number(),
    prompt: v.optional(v.string()),
    status: v.string(),
    exitCode: v.optional(v.number()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        totalTokens: v.number(),
        cacheCreationInputTokens: v.optional(v.number()),
        cacheReadInputTokens: v.optional(v.number()),
      })
    ),
    sessionId: v.optional(v.string()),
    /** Set after this attempt's usage is reflected in `tokenUsageDaily` (write path or backfill). */
    tokenUsageDailyBackfilled: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_started", ["workspaceId", "startedAt"])
    .index("by_project_started", ["projectId", "startedAt"]),

  tokenUsageDaily: defineTable({
    projectId: v.id("projects"),
    day: v.string(),
    agentConfigId: v.id("agentConfigs"),
    agentConfigName: v.string(),
    model: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    cacheCreationTokens: v.number(),
    cacheReadTokens: v.number(),
    runCount: v.number(),
    succeededRuns: v.number(),
    failedRuns: v.number(),
    timedOutRuns: v.number(),
    /** Runs abandoned (e.g. worker restart); optional for rows created before this field existed. */
    abandonedRuns: v.optional(v.number()),
  })
    .index("by_project_day", ["projectId", "day"])
    .index("by_project_agent_day", ["projectId", "agentConfigId", "day"]),

  runAttemptPrompts: defineTable({
    runAttemptId: v.id("runAttempts"),
    prompt: v.string(),
  }).index("by_runAttempt", ["runAttemptId"]),

  agentLogs: defineTable({
    runAttemptId: v.id("runAttempts"),
    workspaceId: v.id("workspaces"),
    timestamp: v.number(),
    stream: v.string(),
    line: v.string(),
    structured: v.optional(v.any()),
  })
    .index("by_run_attempt", ["runAttemptId", "timestamp"])
    .index("by_workspace", ["workspaceId", "timestamp"]),

  comments: defineTable({
    issueId: v.id("issues"),
    body: v.string(),
    author: v.string(),
    runAttemptId: v.optional(v.id("runAttempts")),
    createdAt: v.number(),
  })
    .index("by_issue", ["issueId", "createdAt"])
    .index("by_run_attempt", ["runAttemptId"]),

  attachments: defineTable({
    issueId: v.id("issues"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  }).index("by_issue", ["issueId"]),

  workerState: defineTable({
    workerId: v.string(),
    lastPollAt: v.number(),
    activeCount: v.number(),
    maxConcurrentAgents: v.optional(v.number()),
    maxConcurrentPlanning: v.optional(v.number()),
    maxConcurrentCoding: v.optional(v.number()),
    maxConcurrentTesting: v.optional(v.number()),
    maxConcurrentReviewing: v.optional(v.number()),
  }).index("by_workerId", ["workerId"]),

  promptTemplates: defineTable({
    projectId: v.optional(v.id("projects")), // null = global template
    name: v.string(),
    type: v.union(v.literal("workflow"), v.literal("review"), v.literal("rebase"), v.literal("planning"), v.literal("plan_review"), v.literal("grilling")),
    content: v.string(),
    isDefault: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_type", ["type"])
    .index("by_project_type", ["projectId", "type"]),

  // TODO: remove after YES-255 `deleteAllSkills` migration has run
  skills: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    description: v.string(),
    content: v.string(),
    enabled: v.boolean(),
    source: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  retries: defineTable({
    workspaceId: v.id("workspaces"),
    attemptNumber: v.number(),
    dueAt: v.number(),
    error: v.string(),
    status: v.string(), // "pending", "dispatched", "abandoned"
  })
    .index("by_status_due", ["status", "dueAt"])
    .index("by_workspace", ["workspaceId"]),

  issueHistory: defineTable({
    issueId: v.id("issues"),
    projectId: v.id("projects"),
    action: v.string(),
    field: v.string(),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
    actor: v.union(v.literal("user"), v.literal("system"), v.literal("agent")),
    timestamp: v.number(),
  })
    .index("by_issue", ["issueId", "timestamp"])
    .index("by_project_time", ["projectId", "timestamp"]),

  issueTemplates: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    descriptionTemplate: v.string(),
    defaultTags: v.array(v.string()),
    category: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),
});
