/** Read-only MCP tools available to all phases */
export const READ_ONLY_TOOLS = [
  "mcp__yes-kanban__get_feedback",
  "mcp__yes-kanban__get_current_issue",
  "mcp__yes-kanban__get_project_columns",
  "mcp__yes-kanban__get_workspace_info",
  "mcp__yes-kanban__list_issues",
  "mcp__yes-kanban__get_issue",
  "mcp__yes-kanban__list_attachments",
  "mcp__yes-kanban__list_comments",
];

export const PLANNING_TOOLS = [
  ...READ_ONLY_TOOLS,
  "mcp__yes-kanban__submit_plan",
  "mcp__yes-kanban__ask_question",
  "mcp__yes-kanban__get_plan",
];

export const CODING_TOOLS = [
  ...READ_ONLY_TOOLS,
  "mcp__yes-kanban__add_comment",
  "mcp__yes-kanban__ask_question",
  "mcp__yes-kanban__get_plan",
  "mcp__yes-kanban__create_issue",
  "mcp__yes-kanban__update_issue",
  "mcp__yes-kanban__add_blocker",
  "mcp__yes-kanban__remove_blocker",
];

export const PLANNING_RESEARCH_TOOLS = [
  ...PLANNING_TOOLS,
  "WebSearch",
  "WebFetch",
];

export const REVIEW_TOOLS = [
  ...READ_ONLY_TOOLS,
];
