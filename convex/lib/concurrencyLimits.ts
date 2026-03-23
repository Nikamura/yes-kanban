/** Project / worker concurrency caps must be at least 1 when set to a number. */
export function assertAtLeastOneWhenNumber(fieldName: string, value: unknown): void {
  if (typeof value === "number" && value < 1) {
    throw new Error(`${fieldName} must be >= 1 when set`);
  }
}

const PROJECT_CONCURRENCY_FIELDS = [
  "maxConcurrent",
  "maxConcurrentPlanning",
  "maxConcurrentCoding",
  "maxConcurrentTesting",
  "maxConcurrentReviewing",
] as const;

/** Validates numeric concurrency fields in a projects.update patch (before db.patch). */
export function assertProjectConcurrencyPatch(patch: Record<string, unknown>): void {
  for (const key of PROJECT_CONCURRENCY_FIELDS) {
    assertAtLeastOneWhenNumber(key, patch[key]);
  }
}
