import { describe, test, expect, mock, afterEach } from "bun:test";
import { deliverWebhook } from "../../convex/webhookDeliver";

describe("deliverWebhook", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns success for 200 response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("OK", { status: 200 }))
    ) as unknown as typeof fetch;

    const result = await deliverWebhook({ url: "https://example.com/hook" }, '{"event":"test"}');
    expect(result).toEqual({ ok: true, status: 200 });
  });

  test("returns success for 2xx responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Created", { status: 201 }))
    ) as unknown as typeof fetch;

    const result = await deliverWebhook({ url: "https://example.com/hook" }, '{}');
    expect(result).toEqual({ ok: true, status: 201 });
  });

  test("returns failure with status for HTTP error responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" }))
    ) as unknown as typeof fetch;

    const result = await deliverWebhook({ url: "https://example.com/hook" }, '{}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe("HTTP 404 Not Found");
    }
  });

  test("returns failure with status for 500 responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }))
    ) as unknown as typeof fetch;

    const result = await deliverWebhook({ url: "https://example.com/hook" }, '{}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toContain("500");
    }
  });

  test("returns failure without status for network errors", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Failed to connect"))
    ) as unknown as typeof fetch;

    const result = await deliverWebhook({ url: "https://example.com/hook" }, '{}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBeUndefined();
      expect(result.error).toBe("Failed to connect");
    }
  });

  test("sends correct headers and body", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("OK", { status: 200 }))
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const body = '{"event":"task.created"}';
    await deliverWebhook({ url: "https://example.com/hook" }, body);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(body);
  });

  test("includes HMAC signature header when secret is provided", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("OK", { status: 200 }))
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await deliverWebhook(
      { url: "https://example.com/hook", secret: "my-secret" },
      '{"event":"test"}'
    );

    const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect((init.headers as Record<string, string>)["X-Webhook-Signature"]).toStartWith("sha256=");
    expect((init.headers as Record<string, string>)["X-Webhook-Signature"]).toHaveLength(71);
  });

  test("does not include signature header when no secret", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("OK", { status: 200 }))
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await deliverWebhook({ url: "https://example.com/hook" }, '{}');

    const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect((init.headers as Record<string, string>)["X-Webhook-Signature"]).toBeUndefined();
  });

  test("passes an AbortSignal for timeout", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("OK", { status: 200 }))
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await deliverWebhook({ url: "https://example.com/hook" }, '{}');

    const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("returns failure when fetch is aborted (timeout)", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new DOMException("The operation was aborted", "AbortError"))
    ) as unknown as typeof fetch;

    const result = await deliverWebhook({ url: "https://example.com/hook" }, '{}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("aborted");
    }
  });
});
