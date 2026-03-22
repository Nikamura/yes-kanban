import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export async function sendHeartbeat(convex: ConvexClient, activeCount: number): Promise<void> {
  try {
    await convex.mutation(api.dispatch.heartbeat, { activeCount });
  } catch (err) {
    console.warn("[worker] heartbeat failed:", err);
  }
}
