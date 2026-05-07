/**
 * Shared utilities for voice recording features.
 * Consumed by VoiceRecorder, useVoice, useVoiceConversation, and voice/page.
 */

/** Format elapsed seconds as M:SS (e.g. "0:04", "1:23"). */
export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Decode a base64 data URI (e.g. "data:audio/mpeg;base64,…") into a Blob.
 * Preserves the MIME type embedded in the data URI header.
 * Returns an audio/mpeg Blob when the header is missing or malformed.
 */
export function decodeAudioDataUri(dataUri: string): Blob {
  const commaIdx = dataUri.indexOf(",");
  const header = commaIdx >= 0 ? dataUri.slice(0, commaIdx) : "";
  const b64 = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch?.[1] || "audio/mpeg";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}
