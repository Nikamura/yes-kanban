import { v } from "convex/values";
import {
  mutation,
  query,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  MAX_ATTEMPTS,
  DELIVERY_RETENTION_MS,
  nextRetryAction,
} from "./webhookRetry";
import { deliverWebhook } from "./webhookDeliver";

function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Webhook URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must be a valid HTTPS URL");
  }
}

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhooks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhooks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    url: v.string(),
    events: v.array(v.string()),
    secret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateWebhookUrl(args.url);
    return await ctx.db.insert("webhooks", {
      projectId: args.projectId,
      url: args.url,
      events: args.events,
      enabled: true,
      secret: args.secret,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("webhooks"),
    url: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
    secret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.url !== undefined) {
      validateWebhookUrl(args.url);
    }
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      (Object.entries(updates) as [string, unknown][]).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      await ctx.db.patch(id, filtered);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("webhooks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const fire = action({
  args: {
    projectId: v.id("projects"),
    event: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args): Promise<Array<{ success: boolean; url?: string; status?: number; error?: string }>> => {
    const webhooks: Doc<"webhooks">[] = await ctx.runQuery(
      internal.webhooks.listInternal,
      { projectId: args.projectId }
    );

    const matching = webhooks.filter(
      (wh) => wh.enabled && wh.events.includes(args.event)
    );

    const body = JSON.stringify({
      event: args.event,
      timestamp: Date.now(),
      payload: args.payload,
    });

    const deliveryResults = await Promise.all(
      matching.map(async (wh) => {
        const result = await deliverWebhook(wh, body);
        return { wh, result };
      })
    );

    // Only failed deliveries are tracked in webhookDeliveries (for retry + observability).
    // Successful first-attempt deliveries are not recorded to avoid write amplification.
    const retryPromises: Promise<unknown>[] = [];
    for (const { wh, result } of deliveryResults) {
      if (!result.ok) {
        retryPromises.push(
          ctx.runMutation(internal.webhooks.createDelivery, {
            webhookId: wh._id,
            projectId: args.projectId,
            event: args.event,
            body,
            url: wh.url,
            error: result.error,
            statusCode: result.status,
          })
        );
      }
    }
    await Promise.all(retryPromises);

    return deliveryResults.map(({ wh, result }) =>
      result.ok
        ? { success: true, url: wh.url, status: result.status }
        : { success: false, url: wh.url, status: result.status, error: result.error }
    );
  },
});

// Internal mutation to create a delivery record and schedule the first retry
export const createDelivery = internalMutation({
  args: {
    webhookId: v.id("webhooks"),
    projectId: v.id("projects"),
    event: v.string(),
    body: v.string(),
    url: v.string(),
    error: v.string(),
    statusCode: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // fire() was attempt 1 and it failed, so ask nextRetryAction for the delay.
    // This keeps delay computation in a single code path (no divergent jitter).
    const outcome = nextRetryAction(1, MAX_ATTEMPTS, false);
    if (outcome.action !== "retry") {
      // MAX_ATTEMPTS is 1 — shouldn't happen in practice, but handle gracefully
      return;
    }
    const delayMs = outcome.delayMs;
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      webhookId: args.webhookId,
      projectId: args.projectId,
      event: args.event,
      body: args.body,
      url: args.url,
      attempt: 1,
      maxAttempts: MAX_ATTEMPTS,
      status: "retrying",
      lastError: args.error,
      lastStatusCode: args.statusCode,
      nextRetryAt: Date.now() + delayMs,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(delayMs, internal.webhooks.retryDelivery, {
      deliveryId,
    });

    console.log(
      `Webhook delivery queued for retry: url=${args.url} event=${args.event} nextAttempt=2/${MAX_ATTEMPTS} delay=${delayMs}ms`
    );
  },
});

// Internal action to retry a failed webhook delivery
export const retryDelivery = internalAction({
  args: {
    deliveryId: v.id("webhookDeliveries"),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.runQuery(internal.webhooks.getDelivery, {
      deliveryId: args.deliveryId,
    });

    if (delivery?.status !== "retrying") {
      return;
    }

    // Look up the webhook to get the current secret (don't store secrets in delivery records)
    const webhook = await ctx.runQuery(internal.webhooks.getWebhook, {
      webhookId: delivery.webhookId,
    });

    // If the webhook has been deleted, dead-letter the delivery
    if (!webhook) {
      console.warn(
        `Webhook deleted, dead-lettering delivery: url=${delivery.url} event=${delivery.event}`
      );
      await ctx.runMutation(internal.webhooks.updateDeliveryStatus, {
        deliveryId: args.deliveryId,
        status: "dead_letter",
        attempt: delivery.attempt,
        lastError: "Webhook configuration deleted",
      });
      return;
    }

    // Use the current webhook URL (not the one stored at first failure) so URL
    // fixes take effect on retries. The body is reused for consistent HMAC signatures.
    const currentAttempt = delivery.attempt + 1;
    const actualUrl = webhook.url;
    const result = await deliverWebhook(
      { url: actualUrl, secret: webhook.secret },
      delivery.body
    );

    // Update the delivery record's URL if the webhook URL changed since initial failure
    const urlChanged = actualUrl !== delivery.url ? actualUrl : undefined;

    const outcome = nextRetryAction(currentAttempt, delivery.maxAttempts, result.ok);

    if (result.ok) {
      await ctx.runMutation(internal.webhooks.updateDeliveryStatus, {
        deliveryId: args.deliveryId,
        status: "success",
        attempt: currentAttempt,
        lastStatusCode: result.status,
        url: urlChanged,
      });

      console.log(
        `Webhook delivery succeeded on retry: url=${actualUrl} event=${delivery.event} attempt=${currentAttempt}/${delivery.maxAttempts}`
      );
    } else if (outcome.action === "dead_letter") {
      await ctx.runMutation(internal.webhooks.updateDeliveryStatus, {
        deliveryId: args.deliveryId,
        status: "dead_letter",
        attempt: currentAttempt,
        lastError: result.error,
        lastStatusCode: result.status,
        url: urlChanged,
      });

      console.error(
        `Webhook delivery permanently failed (dead letter): url=${actualUrl} event=${delivery.event} attempt=${currentAttempt}/${delivery.maxAttempts} error=${result.error}`
      );
    } else if (outcome.action === "retry") {
      await ctx.runMutation(internal.webhooks.scheduleNextRetry, {
        deliveryId: args.deliveryId,
        attempt: currentAttempt,
        lastError: result.error,
        lastStatusCode: result.status,
        delayMs: outcome.delayMs,
        url: urlChanged,
      });

      console.log(
        `Webhook delivery retry scheduled: url=${actualUrl} event=${delivery.event} nextAttempt=${currentAttempt + 1}/${delivery.maxAttempts} delay=${outcome.delayMs}ms`
      );
    }
  },
});

export const getDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.deliveryId);
  },
});

export const getWebhook = internalQuery({
  args: { webhookId: v.id("webhooks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.webhookId);
  },
});

export const updateDeliveryStatus = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    status: v.union(
      v.literal("success"),
      v.literal("dead_letter")
    ),
    attempt: v.number(),
    lastError: v.optional(v.string()),
    lastStatusCode: v.optional(v.number()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.deliveryId, {
      status: args.status,
      attempt: args.attempt,
      completedAt: Date.now(),
      nextRetryAt: undefined,
      ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
      ...(args.lastStatusCode !== undefined ? { lastStatusCode: args.lastStatusCode } : {}),
      ...(args.url !== undefined ? { url: args.url } : {}),
    });
  },
});

export const scheduleNextRetry = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    attempt: v.number(),
    lastError: v.string(),
    lastStatusCode: v.optional(v.number()),
    delayMs: v.number(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.deliveryId, {
      attempt: args.attempt,
      lastError: args.lastError,
      lastStatusCode: args.lastStatusCode,
      nextRetryAt: Date.now() + args.delayMs,
      ...(args.url !== undefined ? { url: args.url } : {}),
    });

    await ctx.scheduler.runAfter(args.delayMs, internal.webhooks.retryDelivery, {
      deliveryId: args.deliveryId,
    });
  },
});

// Query dead-lettered deliveries for a project (for observability)
export const listDeadLetters = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "dead_letter")
      )
      .order("desc")
      .take(50);
  },
});

// Query all deliveries for a project (for observability)
export const listDeliveries = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
  },
});

// Public query wrappers for the UI
export const listDeliveriesPublic = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return [];
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
    return deliveries.map(({ body: _, ...rest }) => rest);
  },
});

export const listDeadLettersPublic = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return [];
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "dead_letter")
      )
      .order("desc")
      .take(50);
    return deliveries.map(({ body: _, ...rest }) => rest);
  },
});

// Cleanup old delivery records (runs daily via cron, see convex/crons.ts).
// Processes up to 250 records per status (750 total) per run to stay within
// Convex mutation limits. Large backlogs will be cleaned over multiple runs.
export const cleanupOldDeliveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DELIVERY_RETENTION_MS;
    let deleted = 0;

    // Clean up completed deliveries first
    for (const status of ["success", "dead_letter"] as const) {
      const old = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_status_createdAt", (q) =>
          q.eq("status", status).lt("createdAt", cutoff)
        )
        .take(250);

      for (const delivery of old) {
        await ctx.db.delete(delivery._id);
      }
      deleted += old.length;
    }

    // Move stuck "retrying" records to dead_letter so they appear in observability
    // queries before being purged in a future cleanup run. These indicate orphaned
    // retries where the scheduled action never fired or failed without updating.
    const stuckRetrying = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status_createdAt", (q) =>
        q.eq("status", "retrying").lt("createdAt", cutoff)
      )
      .take(250);

    if (stuckRetrying.length > 0) {
      console.warn(
        `Found ${stuckRetrying.length} stuck "retrying" webhook deliveries older than retention period — moving to dead_letter`
      );
      for (const delivery of stuckRetrying) {
        await ctx.db.patch(delivery._id, {
          status: "dead_letter",
          completedAt: Date.now(),
          nextRetryAt: undefined,
          lastError: delivery.lastError ?? "Orphaned: retry never completed",
        });
      }
    }

    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} old webhook delivery records`);
    }

    return { deleted };
  },
});
