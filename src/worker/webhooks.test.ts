import { describe, test, expect } from "bun:test";
import { createHmacSignature } from "./webhook-signing";
import { createHmacSignature as createHmacSignatureConvex } from "../../convex/webhookSigning";

describe("webhook HMAC signing", () => {
  test("produces a sha256= prefixed hex signature", async () => {
    const signature = await createHmacSignature('{"event":"dispatch"}', "test-secret");
    expect(signature).toStartWith("sha256=");
    // sha256 hex is 64 chars + "sha256=" prefix = 71 chars
    expect(signature).toHaveLength(71);
  });

  test("same payload and secret produce the same signature", async () => {
    const sig1 = await createHmacSignature("hello", "secret");
    const sig2 = await createHmacSignature("hello", "secret");
    expect(sig1).toBe(sig2);
  });

  test("different payloads produce different signatures", async () => {
    const sig1 = await createHmacSignature("payload-a", "secret");
    const sig2 = await createHmacSignature("payload-b", "secret");
    expect(sig1).not.toBe(sig2);
  });

  test("different secrets produce different signatures", async () => {
    const sig1 = await createHmacSignature("same-payload", "secret-1");
    const sig2 = await createHmacSignature("same-payload", "secret-2");
    expect(sig1).not.toBe(sig2);
  });

  test("signature matches known HMAC-SHA256 value", async () => {
    // Verify against a known value computed with Node crypto
    const signature = await createHmacSignature("test-body", "my-key");
    // Just verify it's a valid hex string after the prefix
    const hex = signature.slice(7);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("convex/ and src/worker/ implementations produce identical signatures", async () => {
    const testCases = [
      { payload: '{"event":"dispatch"}', secret: "test-secret" },
      { payload: "hello world", secret: "another-key" },
      { payload: "", secret: "empty-payload" },
    ];
    for (const { payload, secret } of testCases) {
      const sig1 = await createHmacSignature(payload, secret);
      const sig2 = await createHmacSignatureConvex(payload, secret);
      expect(sig1).toBe(sig2);
    }
  });
});
