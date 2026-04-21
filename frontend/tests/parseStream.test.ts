import { describe, it, expect } from "vitest";
import { parseStreamChunk } from "@/lib/parseStream";

// Helper: run multiple chunks sequentially through the parser
function runChunks(chunks: string[]): ReturnType<typeof parseStreamChunk> {
  let state = { accumulated: "", buffer: "", statusUpdates: [] as string[], contentChanged: false };
  for (const chunk of chunks) {
    state = parseStreamChunk(chunk, state.buffer, state.accumulated);
  }
  return state;
}

describe("parseStreamChunk", () => {
  it("accumulates plain content across multiple chunks", () => {
    const r = runChunks(["Hello ", "world"]);
    expect(r.accumulated).toBe("Hello world");
    expect(r.statusUpdates).toEqual([]);
    expect(r.buffer).toBe("");
  });

  it("extracts a STATUS line and excludes it from content", () => {
    const r = parseStreamChunk("\x00STATUS\x00:Thinking…\n", "", "");
    expect(r.statusUpdates).toEqual(["Thinking…"]);
    expect(r.accumulated).toBe("");
    expect(r.buffer).toBe("");
  });

  it("handles content before a STATUS line in one chunk", () => {
    const r = parseStreamChunk("Hello\x00STATUS\x00:Working\nworld", "", "");
    expect(r.accumulated).toBe("Helloworld");
    expect(r.statusUpdates).toEqual(["Working"]);
  });

  it("handles content after a STATUS line", () => {
    const r = parseStreamChunk("\x00STATUS\x00:Searching\nsome text", "", "");
    expect(r.accumulated).toBe("some text");
    expect(r.statusUpdates).toEqual(["Searching"]);
    expect(r.contentChanged).toBe(true);
  });

  it("multiple STATUS lines in one chunk", () => {
    const chunk = "\x00STATUS\x00:Step 1\n\x00STATUS\x00:Step 2\nfinal";
    const r = parseStreamChunk(chunk, "", "");
    expect(r.statusUpdates).toEqual(["Step 1", "Step 2"]);
    expect(r.accumulated).toBe("final");
  });

  it("defers incomplete STATUS sentinel to next chunk", () => {
    // Sentinel split across two chunks
    const r1 = parseStreamChunk("text\x00STATUS\x00:partial", "", "");
    // The incomplete status line should be held in buffer
    expect(r1.accumulated).toBe("text");
    expect(r1.buffer).toBe("\x00STATUS\x00:partial");

    // Second chunk completes the status line
    const r2 = parseStreamChunk(" done\n", r1.buffer, r1.accumulated);
    expect(r2.statusUpdates).toEqual(["partial done"]);
    expect(r2.accumulated).toBe("text");
    expect(r2.buffer).toBe("");
  });

  it("returns contentChanged=true when real content is added", () => {
    const r = parseStreamChunk("hi", "", "");
    expect(r.contentChanged).toBe(true);
  });

  it("returns contentChanged=false for STATUS-only chunk", () => {
    const r = parseStreamChunk("\x00STATUS\x00:msg\n", "", "");
    expect(r.contentChanged).toBe(false);
  });

  it("preserves previously accumulated content", () => {
    const r = parseStreamChunk(" world", "", "Hello");
    expect(r.accumulated).toBe("Hello world");
  });

  it("handles empty chunk", () => {
    const r = parseStreamChunk("", "", "existing");
    expect(r.accumulated).toBe("existing");
    expect(r.buffer).toBe("");
    expect(r.statusUpdates).toEqual([]);
  });

  it("trims whitespace from STATUS text", () => {
    const r = parseStreamChunk("\x00STATUS\x00:  spaced  \n", "", "");
    expect(r.statusUpdates).toEqual(["spaced"]);
  });
});
