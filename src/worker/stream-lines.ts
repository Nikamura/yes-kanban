/**
 * Consume a process stdout/stderr byte stream as UTF-8 lines (TextDecoder streaming
 * semantics match AgentExecutor). Used by worktree scripts, test runs, and the agent executor.
 */
export async function consumeStreamLines(
  reader: ReadableStream<Uint8Array>,
  stream: "stdout" | "stderr",
  options: {
    /** When set, each decoded line (with `\n`) and trailing fragment are appended for full output capture. */
    outParts?: string[];
    onLine?: (stream: "stdout" | "stderr", line: string) => void;
    /** Invoked once per input chunk (e.g. agent stall / activity tracking). */
    onChunk?: () => void;
  } = {},
): Promise<void> {
  const { outParts, onLine, onChunk } = options;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of reader) {
    onChunk?.();
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      outParts?.push(line + "\n");
      if (line) onLine?.(stream, line);
    }
  }
  if (buffer) {
    outParts?.push(buffer);
    if (buffer) onLine?.(stream, buffer);
  }
}
