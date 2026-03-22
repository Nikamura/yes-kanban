export const VALID_CARD_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#10B981",
  "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899",
] as const;

const VALID_CARD_COLORS_SET = new Set<string>(VALID_CARD_COLORS);

export function validateCardColor(color: string): void {
  if (!VALID_CARD_COLORS_SET.has(color)) {
    throw new Error("Invalid card color");
  }
}

export function validateIssueTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Title must not be empty");
  }
  if (trimmed.length > 500) {
    throw new Error("Title must be 500 characters or fewer");
  }
  return trimmed;
}

export function validateIssueDescription(description: string): void {
  if (description.length > 50000) {
    throw new Error("Description must be 50,000 characters or fewer");
  }
}

export function validateChecklistItemText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Checklist item text must not be empty");
  }
  if (trimmed.length > 1000) {
    throw new Error("Checklist item text must be 1000 characters or fewer");
  }
  return trimmed;
}

export const MAX_CHECKLIST_ITEMS = 100;

export function validateCommentBody(body: string): void {
  if (body.length > 50000) {
    throw new Error("Comment body must be 50,000 characters or fewer");
  }
}
