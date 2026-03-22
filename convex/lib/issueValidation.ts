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
