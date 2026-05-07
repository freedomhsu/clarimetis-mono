import { describe, it, expect } from "vitest";
import { formatTime, decodeAudioDataUri } from "@/lib/voice-utils";

// ── formatTime ────────────────────────────────────────────────────────────

describe("formatTime", () => {
  it.each([
    [0, "0:00"],
    [4, "0:04"],
    [9, "0:09"],
    [59, "0:59"],
    [60, "1:00"],
    [65, "1:05"],
    [600, "10:00"],
    [3661, "61:01"],
  ])("formatTime(%i) === %s", (seconds, expected) => {
    expect(formatTime(seconds)).toBe(expected);
  });

  it("pads seconds to two digits", () => {
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(609)).toBe("10:09");
  });
});

// ── decodeAudioDataUri ────────────────────────────────────────────────────

describe("decodeAudioDataUri", () => {
  function makeUri(mime: string, ...byteValues: number[]): string {
    const b64 = btoa(String.fromCharCode(...byteValues));
    return `data:${mime};base64,${b64}`;
  }

  it("returns a Blob with the correct MIME type", () => {
    const blob = decodeAudioDataUri(makeUri("audio/mpeg", 0xff, 0xfb, 0x90, 0x00));
    expect(blob.type).toBe("audio/mpeg");
  });

  it("preserves non-mpeg MIME types", () => {
    expect(decodeAudioDataUri(makeUri("audio/webm", 1)).type).toBe("audio/webm");
    expect(decodeAudioDataUri(makeUri("video/mp4", 1)).type).toBe("video/mp4");
  });

  it("decodes base64 bytes correctly", async () => {
    const bytes = [1, 2, 3, 255];
    const blob = decodeAudioDataUri(makeUri("audio/mpeg", ...bytes));
    const buf = await blob.arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual(bytes);
  });

  it("blob size matches the decoded byte count", () => {
    const blob = decodeAudioDataUri(makeUri("audio/mpeg", 10, 20, 30));
    expect(blob.size).toBe(3);
  });

  it("falls back to audio/mpeg when there is no data: header", () => {
    // Raw base64 with no data URI prefix
    const blob = decodeAudioDataUri(btoa("raw-audio"));
    expect(blob.type).toBe("audio/mpeg");
  });

  it("falls back to audio/mpeg when MIME is absent from the header", () => {
    // Header present but no MIME type before the semicolon
    const blob = decodeAudioDataUri(`data:;base64,${btoa("x")}`);
    expect(blob.type).toBe("audio/mpeg");
  });

  it("handles a data URI produced by the backend (round-trip)", async () => {
    // Simulate the exact format the backend returns
    const original = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x64]);
    const b64 = btoa(String.fromCharCode(...original));
    const dataUri = `data:audio/mpeg;base64,${b64}`;

    const blob = decodeAudioDataUri(dataUri);
    expect(blob.type).toBe("audio/mpeg");
    const buf = await blob.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(original);
  });
});
