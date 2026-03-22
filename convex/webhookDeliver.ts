import { createHmacSignature } from "./webhookSigning";

/** Timeout for webhook delivery HTTP requests */
const DELIVERY_TIMEOUT_MS = 30_000;

export interface DeliverySuccess {
  ok: true;
  status: number;
}

export interface DeliveryFailure {
  ok: false;
  status?: number;
  error: string;
}

export type DeliveryResult = DeliverySuccess | DeliveryFailure;

export async function deliverWebhook(
  wh: { url: string; secret?: string },
  body: string
): Promise<DeliveryResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (wh.secret) {
      const signature = await createHmacSignature(body, wh.secret);
      headers["X-Webhook-Signature"] = signature;
    }

    const res = await fetch(wh.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status} ${res.statusText}` };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
