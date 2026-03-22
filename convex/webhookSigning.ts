/**
 * Creates an HMAC-SHA256 signature for webhook payloads.
 * Uses the Web Crypto API so it works in the Convex action runtime.
 *
 * Duplicated from src/worker/webhook-signing.ts to stay within the convex/
 * bundle boundary — Convex only bundles files inside convex/.
 */
export async function createHmacSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  const hashArray = Array.from(new Uint8Array(signature));
  return "sha256=" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
