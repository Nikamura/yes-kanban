import { KANBAN_COLUMNS, type ImportedIssue } from "./index";

/**
 * Shape of a GitHub issue as returned by:
 *   gh issue list --json title,body,state,labels,number --repo <repo>
 */
export interface GitHubIssue {
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name: string }>;
  number: number;
}

/**
 * Map a GitHub issue state to a kanban column.
 */
export function mapGitHubStatus(state: string): string {
  switch (state.toUpperCase()) {
    case "CLOSED":
      return KANBAN_COLUMNS.DONE;
    case "OPEN":
    default:
      return KANBAN_COLUMNS.TODO;
  }
}

/**
 * Parse GitHub issue JSON (from `gh issue list --json ...`) into ImportedIssues.
 */
export function parseGitHubIssues(issues: GitHubIssue[]): ImportedIssue[] {
  return issues.map((issue) => ({
    title: issue.title,
    description: issue.body ?? "",
    status: mapGitHubStatus(issue.state),
    tags: issue.labels.map((l) => l.name),
    externalId: `github-${issue.number}`,
  }));
}
