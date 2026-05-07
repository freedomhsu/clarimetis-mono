/**
 * Pure streaming-parser for the chat endpoint SSE-like protocol.
 *
 * Chunks arrive as raw bytes from the server. The server multiplexes two
 * types of data over a single stream:
 *
 *   - Real content: plain text
 *   - Status updates: `\x00STATUS\x00:<text>\n`
 *
 * The parser accumulates content across calls and extracts status lines,
 * returning them separately so the caller can update UI state.
 */

export interface ParseResult {
  /** All real content accumulated so far (across all calls). */
  accumulated: string;
  /** Incomplete data that must be prepended to the next chunk. */
  buffer: string;
  /** Status strings extracted from this chunk (in order). */
  statusUpdates: string[];
  /** Whether any real content was added by this chunk. */
  contentChanged: boolean;
}

/**
 * Process one raw decoded string chunk from the stream.
 *
 * @param chunk   - The decoded text from the current read (may be partial).
 * @param buffer  - Leftover from the previous call (initially `""`).
 * @param accumulated - Content accumulated before this call (initially `""`).
 */
export function parseStreamChunk(
  chunk: string,
  buffer: string,
  accumulated: string,
): ParseResult {
  let buf = buffer + chunk;
  let acc = accumulated;
  const statusUpdates: string[] = [];
  let contentChanged = false;
  const SENTINEL = "\x00STATUS\x00:";

  const parts = buf.split(SENTINEL);
  // parts[0] is real content (before the first sentinel, if any)
  acc += parts[0];
  if (parts[0]) contentChanged = true;

  let newBuffer = "";
  for (let i = 1; i < parts.length; i++) {
    const newlineIdx = parts[i].indexOf("\n");
    if (newlineIdx !== -1) {
      const statusText = parts[i].slice(0, newlineIdx).trim();
      statusUpdates.push(statusText);
      const extra = parts[i].slice(newlineIdx + 1);
      acc += extra;
      if (extra) contentChanged = true;
    } else {
      // Incomplete status line — defer to next chunk
      newBuffer = SENTINEL + parts[i];
    }
  }

  // If the last completed segment ended with a newline (or there was only real
  // content), the buffer is empty; otherwise it holds the incomplete sentinel.
  if (parts[parts.length - 1].indexOf("\n") !== -1 || parts.length === 1) {
    newBuffer = "";
  }

  // Guard against the SENTINEL being split across two network chunks.
  // If `acc` ends with a prefix of SENTINEL, hold those bytes back so the
  // next chunk gets a chance to complete the match instead of treating them
  // as real content (which would render as visible garbage characters).
  if (!newBuffer) {
    for (let len = Math.min(SENTINEL.length - 1, acc.length); len >= 1; len--) {
      if (acc.endsWith(SENTINEL.slice(0, len))) {
        newBuffer = acc.slice(-len);
        acc = acc.slice(0, -len);
        break;
      }
    }
  }

  return { accumulated: acc, buffer: newBuffer, statusUpdates, contentChanged };
}
