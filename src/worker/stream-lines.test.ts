import { describe, test, expect } from "bun:test";
import { consumeStreamLines } from "./stream-lines";

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
}

describe("consumeStreamLines", () => {
  test("splits lines and collects outParts", async () => {
    const parts: string[] = [];
    const lines: string[] = [];
    await consumeStreamLines(streamFromString("a\nb\n"), "stdout", {
      outParts: parts,
      onLine: (_s, line) => lines.push(line),
    });
    expect(parts.join("")).toBe("a\nb\n");
    expect(lines).toEqual(["a", "b"]);
  });

  test("emits trailing fragment without newline", async () => {
    const lines: string[] = [];
    await consumeStreamLines(streamFromString("tail"), "stderr", {
      onLine: (_s, line) => lines.push(line),
    });
    expect(lines).toEqual(["tail"]);
  });

  test("invokes onChunk per chunk", async () => {
    let chunks = 0;
    await consumeStreamLines(streamFromString("x"), "stdout", {
      onChunk: () => {
        chunks++;
      },
    });
    expect(chunks).toBe(1);
  });
});
