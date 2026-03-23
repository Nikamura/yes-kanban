import type { Doc } from "../../convex/_generated/dataModel";
import type { WorktreeEntry, AttachmentInfo } from "./types";

/** Format byte size to human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Render attachment list lines for prompts. */
function renderAttachments(attachments: AttachmentInfo[]): string[] {
  const lines: string[] = ["\n## Attachments"];
  for (const att of attachments) {
    if (att.localPath) {
      lines.push(`- ${att.filename} — local path: ${att.localPath} (${att.mimeType}, ${formatBytes(att.size)})`);
    } else {
      lines.push(`- [${att.filename}](${att.url}) (${att.mimeType}, ${formatBytes(att.size)})`);
    }
  }
  return lines;
}

/**
 * Replace {{placeholder}} tokens in a template string with actual values.
 */
function interpolate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

/**
 * Build the prompt sent to the coding agent.
 * If a custom template is provided, it replaces the hardcoded Instructions section.
 */
export function buildPrompt(
  issue: Doc<"issues"> | undefined,
  additionalPrompt: string | undefined,
  worktrees: WorktreeEntry[],
  resumed = false,
  lastError?: string,
  template?: string,
  attachments?: AttachmentInfo[],
  plan?: string,
  experimentNumber?: number,
): string {
  const parts: string[] = [];

  if (issue) {
    parts.push(`# Task: ${issue.title}`);
    parts.push(`Issue ID: ${issue.simpleId}`);
    if (issue.description) {
      parts.push(`\n## Description\n${issue.description}`);
    }
    if (issue.tags.length > 0) {
      parts.push(`Tags: ${issue.tags.join(", ")}`);
    }
  }

  if (attachments && attachments.length > 0) {
    parts.push(...renderAttachments(attachments));
  }

  if (worktrees.length > 0) {
    parts.push("\n## Workspace");
    for (const wt of worktrees) {
      parts.push(`- Repository: ${wt.repoPath}`);
      parts.push(`  Branch: ${wt.branchName} (based on ${wt.baseBranch})`);
      parts.push(`  Path: ${wt.worktreePath}`);
    }
  }

  if (resumed) {
    parts.push("\n## RESUMED — Continuing Previous Attempt");
    parts.push("This task was started previously but did not complete.");
    if (lastError) {
      parts.push(`\n### Previous Failure\nThe previous attempt failed with: ${lastError}`);
    }
    parts.push("\nCheck the existing commits on this branch with `git log` and review the current state of the code.");
    parts.push("Continue from where the previous attempt left off — do not redo work that is already done.");
    if (lastError) {
      parts.push("Be mindful of the previous failure reason and take a different approach if needed.");
    }
  }

  if (template) {
    const vars: Record<string, string> = {
      issueId: issue?.simpleId ?? "N/A",
      title: issue?.title ?? "Unknown",
    };
    parts.push(`\n## Instructions\n${interpolate(template, vars)}`);
  } else {
    parts.push("\n## Instructions");
    parts.push("1. Implement the changes described above.");
    parts.push("2. Self-review your changes before finishing.");
    parts.push("3. Run tests if available and fix any failures.");
    parts.push(`4. Commit your changes with meaningful commit messages referencing ${issue?.simpleId ?? "this task"}.`);
    parts.push("5. Do not exit until you believe the work is complete and tests pass.");
    parts.push(
      `6. If you notice anything that should be improved but is out of scope for this task, create a new Backlog ticket for it using the \`create_issue\` tool with \`status: "Backlog"\`. Include a reference to the current task (${issue?.simpleId ?? "this task"}) in the description. Do NOT leave "notes" or "observations" as comments — create tickets instead so they can be planned.`,
    );
  }

  if (plan) {
    parts.push(`\n## Approved Implementation Plan`);
    if (experimentNumber && experimentNumber > 1) {
      parts.push(`(Experiment #${experimentNumber} — previous experiments were discarded, start fresh)`);
    }
    parts.push(plan);
  }

  if (additionalPrompt) {
    parts.push(`\n## Additional Instructions\n${additionalPrompt}`);
  }

  return parts.join("\n");
}

/**
 * Build the prompt for the fix cycle after a review requests changes.
 */
export function buildFixPrompt(reviewFeedback: string): string {
  return `Changes requested:\n\n${reviewFeedback}\n\nPlease address these issues.`;
}

/**
 * Build the prompt for a review run.
 * If a custom template is provided, it replaces the Review Criteria + Output Format sections.
 */
export function buildReviewPrompt(
  issue: Doc<"issues"> | undefined,
  diff: string,
  template?: string,
  attachments?: AttachmentInfo[],
): string {
  const parts: string[] = [];

  parts.push("# Code Review");
  parts.push(`\nReview the following changes for issue: ${issue?.title ?? "Unknown"} (${issue?.simpleId ?? "N/A"})`);
  if (issue?.description) {
    parts.push(`\n## Original Requirements\n${issue.description}`);
  }

  if (attachments && attachments.length > 0) {
    parts.push(...renderAttachments(attachments));
  }

  parts.push("\n## Changes to Review");
  parts.push("```diff");
  parts.push(diff);
  parts.push("```");

  if (template) {
    const vars: Record<string, string> = {
      issueId: issue?.simpleId ?? "N/A",
      title: issue?.title ?? "Unknown",
    };
    parts.push(`\n## Review Instructions\n${interpolate(template, vars)}`);
  } else {
    parts.push("\n## Review Criteria");
    parts.push("Check for:");
    parts.push("- Bugs and logic errors");
    parts.push("- Missing edge cases");
    parts.push("- Code style issues");
    parts.push("- Security concerns");
    parts.push("- Missing or inadequate tests");
    parts.push("- Documentation gaps");

    parts.push("\n## Output Format");
    parts.push("Write your review analysis, then end your response with a verdict line:");
    parts.push("```");
    parts.push("FINAL_VERDICT: APPROVE");
    parts.push("FINAL_VERDICT: CONCERN — <brief reason>");
    parts.push("FINAL_VERDICT: REQUEST_CHANGES — <brief reason>");
    parts.push("```");
    parts.push("APPROVE = changes are good. CONCERN = non-blocking note. REQUEST_CHANGES = must fix before merge.");
    parts.push("**You MUST end with exactly one `FINAL_VERDICT:` line.**");
  }

  return parts.join("\n");
}

/**
 * Build the prompt for AI plan review.
 * A separate agent session evaluates the plan against the original requirements.
 */
export function buildPlanReviewPrompt(
  issue: Doc<"issues"> | undefined,
  plan: string,
  template?: string,
  attachments?: AttachmentInfo[],
): string {
  const parts: string[] = [];

  parts.push("# Plan Review");
  parts.push(`\nReview the following implementation plan for issue: ${issue?.title ?? "Unknown"} (${issue?.simpleId ?? "N/A"})`);
  if (issue?.description) {
    parts.push(`\n## Original Requirements\n${issue.description}`);
  }

  if (attachments && attachments.length > 0) {
    parts.push(...renderAttachments(attachments));
  }

  parts.push("\n## Plan to Review");
  parts.push(plan);

  if (template) {
    const vars: Record<string, string> = {
      issueId: issue?.simpleId ?? "N/A",
      title: issue?.title ?? "Unknown",
    };
    parts.push(`\n## Review Instructions\n${interpolate(template, vars)}`);
  } else {
    parts.push("\n## Review Criteria");
    parts.push("Check for:");
    parts.push("- Completeness: Does the plan address all requirements?");
    parts.push("- Feasibility: Is the approach technically sound?");
    parts.push("- Risk assessment: Are edge cases and risks identified?");
    parts.push("- Scope: Is the plan appropriately scoped (not too broad, not too narrow)?");
    parts.push("- Testing strategy: Is there a clear testing plan?");

    parts.push("\n## Output Format");
    parts.push("Write your review analysis, then end your response with a verdict line:");
    parts.push("```");
    parts.push("FINAL_VERDICT: APPROVE");
    parts.push("FINAL_VERDICT: REQUEST_CHANGES — <brief reason>");
    parts.push("FINAL_VERDICT: RESTART — <brief reason>");
    parts.push("```");
    parts.push("APPROVE = plan is ready. REQUEST_CHANGES = needs improvements. RESTART = fundamentally flawed.");
    parts.push("**You MUST end with exactly one `FINAL_VERDICT:` line.**");
  }

  return parts.join("\n");
}

/**
 * Build the prompt for the planning stage.
 * The agent should analyze the task, create a plan, and ask clarifying questions.
 */
export function buildPlanningPrompt(
  issue: Doc<"issues"> | undefined,
  worktrees: WorktreeEntry[],
  existingPlan?: string,
  answeredQuestions?: Array<{ question: string; answer: string }>,
  feedback?: string[],
  reviewerFeedback?: string,
  deepResearch?: boolean,
  attachments?: AttachmentInfo[],
): string {
  const parts: string[] = [];

  parts.push("# Planning Phase");
  if (issue) {
    parts.push(`\nTask: ${issue.title} (${issue.simpleId})`);
    if (issue.description) {
      parts.push(`\n## Requirements\n${issue.description}`);
    }
    if (issue.tags.length > 0) {
      parts.push(`Tags: ${issue.tags.join(", ")}`);
    }
  }

  if (attachments && attachments.length > 0) {
    parts.push(...renderAttachments(attachments));
  }

  if (worktrees.length > 0) {
    parts.push("\n## Workspace");
    for (const wt of worktrees) {
      parts.push(`- Repository: ${wt.repoPath}`);
      parts.push(`  Branch: ${wt.branchName} (based on ${wt.baseBranch})`);
      parts.push(`  Path: ${wt.worktreePath}`);
    }
  }

  if (existingPlan) {
    parts.push("\n## Previous Plan (needs revision)");
    parts.push(existingPlan);
    parts.push("\n**IMPORTANT:** You must revise this plan based on any new feedback or answered questions, then submit the updated plan using the `mcp__yes-kanban__submit_plan` MCP tool. Do NOT use Claude Code's built-in plan mode — use the MCP tool.");
  }

  if (existingPlan && feedback && feedback.length > 0) {
    parts.push("\n## User Feedback on Previous Plan");
    for (const fb of feedback) {
      parts.push(`\n${fb}`);
    }
    parts.push("\n**You MUST address this feedback in your revised plan.**");
  }

  if (existingPlan && reviewerFeedback) {
    parts.push("\n## AI Reviewer Feedback on Previous Plan");
    parts.push(reviewerFeedback);
    parts.push("\n**You MUST address this feedback in your revised plan.**");
  }

  if (answeredQuestions && answeredQuestions.length > 0) {
    parts.push("\n## Answered Questions");
    for (const qa of answeredQuestions) {
      parts.push(`\n**Q:** ${qa.question}`);
      parts.push(`**A:** ${qa.answer}`);
    }
  }

  parts.push("\n## Instructions");
  parts.push("You are in the **planning phase**. Your job is to create an implementation plan before any code is written.");
  parts.push("");
  parts.push("1. **Explore the codebase** — read relevant files to understand the current architecture.");
  parts.push("   - Read the files most likely affected by the change");
  parts.push("   - Trace code paths related to the task (entry points, data flow, dependencies)");
  parts.push("   - Identify existing patterns, utilities, and abstractions that should be reused");
  parts.push("   - Note tests that cover the affected areas");
  if (deepResearch) {
    parts.push("2. **Research online** — you have `WebSearch` and `WebFetch` tools available. Use them to research relevant documentation, APIs, best practices, or any external information that would improve your plan.");
    parts.push("3. **Ask clarifying questions** — use the `mcp__yes-kanban__ask_question` MCP tool for anything ambiguous.");
    parts.push("4. **Create a plan** — use the `mcp__yes-kanban__submit_plan` MCP tool to submit a structured plan covering:");
  } else {
    parts.push("2. **Ask clarifying questions** — use the `mcp__yes-kanban__ask_question` MCP tool for anything ambiguous.");
    parts.push("3. **Create a plan** — use the `mcp__yes-kanban__submit_plan` MCP tool to submit a structured plan covering:");
  }
  parts.push("   - **Key changes needed**: list every file to be modified or created, describe what changes and why for each, include schema changes, new API endpoints, and UI changes");
  parts.push("   - **Implementation approach**: step-by-step implementation order, explain architectural decisions and trade-offs, reference existing codebase patterns to follow, call out any new dependencies");
  parts.push("   - **Risks and edge cases**: backwards compatibility concerns, data migration needs, error scenarios, performance implications, concurrent access issues");
  parts.push("   - **Testing strategy**: types of tests needed (unit, integration, e2e), specific test files to modify or create, key scenarios to cover including happy path and error cases");
  parts.push("");
  parts.push("A good plan is one where a junior engineer could implement the task from the plan alone, with minimal ambiguity. Use concrete file paths, function names, and code references. Explain *why* each change is needed, not just *what* to change.");
  parts.push("");
  parts.push("**Do NOT write any code during this phase.** Only explore, ask questions, and submit a plan.");
  parts.push("**CRITICAL:** You MUST submit your plan by calling the `mcp__yes-kanban__submit_plan` MCP tool. Do NOT use Claude Code's built-in plan mode or ExitPlanMode — those are disabled. The only way to submit is via the MCP tool.");
  parts.push("After submitting your plan via the MCP tool, exit and wait for user approval.");

  return parts.join("\n");
}

/**
 * Pre-planning "grill me" interview — stress-test the design before a formal plan is written.
 */
export function buildGrillingPrompt(
  issue: Doc<"issues"> | undefined,
  worktrees: WorktreeEntry[],
  answeredQuestions?: Array<{ question: string; answer: string }>,
  attachments?: AttachmentInfo[],
  customInstructions?: string,
  isResuming?: boolean,
): string {
  const parts: string[] = [];

  if (isResuming) {
    parts.push("The user has provided responses. Continue the grill interview:");
  }

  parts.push("# Grill Me (pre-planning interview)");

  if (issue) {
    parts.push(`\nTask: ${issue.title} (${issue.simpleId})`);
    if (issue.description) {
      parts.push(`\n## Requirements\n${issue.description}`);
    }
  }

  if (attachments && attachments.length > 0) {
    parts.push(...renderAttachments(attachments));
  }

  if (worktrees.length > 0) {
    parts.push("\n## Workspace");
    for (const wt of worktrees) {
      parts.push(`- Repository: ${wt.repoPath}`);
      parts.push(`  Branch: ${wt.branchName} (based on ${wt.baseBranch})`);
      parts.push(`  Path: ${wt.worktreePath}`);
    }
  }

  if (answeredQuestions && answeredQuestions.length > 0) {
    parts.push("\n## Answered Questions");
    for (const qa of answeredQuestions) {
      parts.push(`\n**Q:** ${qa.question}`);
      parts.push(`**A:** ${qa.answer}`);
    }
  }

  if (customInstructions) {
    parts.push(`\n## Custom instructions\n${customInstructions}`);
  }

  parts.push("\n## Your mission");
  parts.push(
    "Interview the user relentlessly about every aspect of this plan or design until you reach a shared understanding. " +
      "Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.",
  );
  parts.push(
    "For each question, state your **recommended answer** in your message, then ask **one** follow-up via " +
      "`mcp__yes-kanban__ask_question` with exactly **3** suggested answers.",
  );
  parts.push(
    "If a question can be answered by exploring the codebase, explore the codebase instead of asking the user.",
  );
  parts.push(
    "When the design is sufficiently explored and there are no unresolved branches, **finish** without calling `ask_question` again.",
  );
  parts.push(
    "\n**Do NOT** call `mcp__yes-kanban__submit_plan` or `mcp__yes-kanban__get_plan` during this phase. Planning follows after grilling completes.",
  );

  return parts.join("\n");
}

/**
 * Build the prompt for resolving rebase conflicts.
 * If a custom template is provided, it replaces the hardcoded instructions.
 */
export function buildRebaseConflictPrompt(
  baseBranch: string,
  conflictedFiles: string[],
  template?: string,
): string {
  const parts: string[] = [];

  if (template) {
    const vars: Record<string, string> = { baseBranch };
    parts.push(interpolate(template, vars));
  } else {
    parts.push("# Resolve Rebase Conflicts");
    parts.push(`\nA \`git rebase origin/${baseBranch}\` is in progress and has conflicts.`);
  }

  parts.push("\n## Conflicted Files");
  for (const file of conflictedFiles) {
    parts.push(`- ${file}`);
  }

  if (!template) {
    parts.push("\n## Instructions");
    parts.push("1. Open each conflicted file and resolve the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).");
    parts.push("2. After resolving a file, run `git add <file>` to mark it resolved.");
    parts.push("3. Once all conflicts are resolved, run `git rebase --continue`.");
    parts.push("4. If `rebase --continue` produces new conflicts, repeat steps 1-3.");
    parts.push("5. Continue until the rebase is fully complete.");
    parts.push("\n**IMPORTANT:** Do NOT run `git rebase --abort`. You must resolve the conflicts.");
  }

  return parts.join("\n");
}
