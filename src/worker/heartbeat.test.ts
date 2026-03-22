import { describe, it, expect, mock } from "bun:test";
import { sendHeartbeat } from "./heartbeat";

describe("heartbeat", () => {
  it("calls the heartbeat mutation with activeCount", async () => {
    const mockMutation = mock(() => Promise.resolve());
    const mockConvex = {
      mutation: mockMutation,
    };

    await sendHeartbeat(mockConvex as any, 2);

    expect(mockMutation).toHaveBeenCalledTimes(1);
    const call = mockMutation.mock.calls[0] as any[];
    // Check the second arg contains activeCount
    expect(call[1]).toEqual({ activeCount: 2 });
  });

  it("does not throw on mutation error", async () => {
    const mockConvex = {
      mutation: mock(() => Promise.reject(new Error("network error"))),
    };

    // Should not throw
    await sendHeartbeat(mockConvex as any, 0);
  });
});
