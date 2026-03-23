import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalMutation } from "./_generated/server";

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
});

// Registered via internalMutationGeneric — on `internal.migrations.run` only, not `api`.
// bunx convex run migrations:run '{"fn":"migrations:myMigration"}'
export const run = migrations.runner();

// Run all migrations in order. Add new migrations to the array below in chronological order.
// Uses runSerially so an empty list is a no-op (runner([]) from the component cannot be used with zero migrations).
// Internal mutation (not exposed on `api`). `convex run` and `bun run migrate` use the deployment admin key and may invoke it.
// bunx convex run migrations:runAll
export const runAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    await migrations.runSerially(ctx, [
      // import { internal } from "./_generated/api.js";
      // internal.migrations.myFirstMigration,
    ]);
  },
});
