import type { Doc } from "../../convex/_generated/dataModel";

export type SortKey =
  | "position"
  | "createdAt"
  | "updatedAt"
  | "simpleId"
  | "title"
  | "status";

export function filterIssues(
  issues: Doc<"issues">[],
  opts: {
    search: string;
    filterStatus?: string;
    searchDescription?: boolean;
    filterWorkspaceStatuses?: Set<string>;
    workspaceStatuses?: Record<string, { status: string }>;
  }
): Doc<"issues">[] {
  let result = issues;
  if (opts.filterStatus) {
    result = result.filter((i) => i.status === opts.filterStatus);
  }
  if (opts.filterWorkspaceStatuses && opts.filterWorkspaceStatuses.size > 0 && opts.workspaceStatuses) {
    const wsStatuses = opts.workspaceStatuses;
    const filterSet = opts.filterWorkspaceStatuses;
    result = result.filter((i) => {
      const ws = wsStatuses[i._id];
      return ws ? filterSet.has(ws.status) : false;
    });
  }
  if (opts.search) {
    const s = opts.search.toLowerCase();
    result = result.filter(
      (i) =>
        i.title.toLowerCase().includes(s) ||
        i.simpleId.toLowerCase().includes(s) ||
        (opts.searchDescription && i.description.toLowerCase().includes(s))
    );
  }
  return result;
}

export function sortIssues(key: SortKey, ascending = true) {
  return (a: Doc<"issues">, b: Doc<"issues">): number => {
    let cmp: number;
    switch (key) {
      case "position":
        cmp = a.position - b.position;
        break;
      case "createdAt":
        cmp = a.createdAt - b.createdAt;
        break;
      case "updatedAt":
        cmp = a.updatedAt - b.updatedAt;
        break;
      case "simpleId":
        cmp = a.simpleId.localeCompare(b.simpleId);
        break;
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      default:
        key satisfies never;
        cmp = 0;
    }
    return ascending ? cmp : -cmp;
  };
}
