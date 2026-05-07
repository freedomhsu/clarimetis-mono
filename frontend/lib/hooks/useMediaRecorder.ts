"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Preferred MIME type — best quality with widest support (Chrome, Firefox, Edge).
 * Safari records natively as audio/mp4; MediaRecorder falls back automatically.
 */
const PREFERRED_MIME = "audio/webm;codecs=opus";

export interface UseMediaRecorderOptions {
  /**
   * Auto-stop recording after this many milliseconds to prevent oversized blobs
   * that would exceed the backend's 10 MB upload limit.
   * Default: 120_000 (2 minutes).
   */
  maxRecordingMs?: number;
  /** Called once with the fully assembled Blob when recording stops. */
  onStop: (blob: Blob, mimeType: string) => void;
  /** Called on getUserMedia denial or MediaRecorder runtime error. */
  onError?: (message: string) => void;
}

/**
 * Low-level MediaRecorder primitive shared by useVoice and useVoiceConversation.
 *
 * Responsibilities:
 *  - getUserMedia / microphone track release
 *  - Codec selection (webm/opus → browser default; Safari records mp4 natively)
 *  - Audio chunk assembly
 *  - Elapsed-time counter
 *  - Auto-stop safety timer (configurable)
 *  - Full cleanup on unmount
 *
 * Callbacks are read through a ref so they are never stale inside onstop/onerror
 * regardless of how often the parent re-renders.
 */
export function useMediaRecorder({
  maxRecordingMs = 120_000,
  onStop,
  onError,
}: UseMediaRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Always-current callback refs — updating them is side-effect free (no re-render).
  // This lets `start` remain stable even when the parent passes new arrow functions.
  const cbRef = useRef({ onStop, onError });
  cbRef.current = { onStop, onError };

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Cancel both running timers. Safe to call when either/both are null. */
  const _clearTimers = () => {
    if (tickRef.current !== null) { clearInterval(tickRef.current); tickRef.current = null; }
    if (maxTimerRef.current !== null) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  };

  /** Stop all microphone tracks and release the stream. */
  const _releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Full cleanup on unmount — detach onstop before stopping so the consumer
  // never receives a callback after the component tree has already torn down.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      _clearTimers();
      _releaseStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      cbRef.current.onError?.("Microphone access denied.");
      return;
    }
    streamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? PREFERRED_MIME : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onerror = () => {
      _clearTimers();
      _releaseStream();
      setIsRecording(false);
      setRecordingSeconds(0);
      cbRef.current.onError?.("Recording failed. Please try again.");
    };

    recorder.onstop = () => {
      _clearTimers();
      _releaseStream();
      setIsRecording(false);
      setRecordingSeconds(0);
      // Strip codec parameters (e.g. "audio/webm;codecs=opus" → "audio/webm")
      // so the Blob's type is a clean MIME string the backend can validate.
      const blobMime = (recorder.mimeType || "audio/webm").split(";")[0];
      const blob = new Blob(chunksRef.current, { type: blobMime });
      cbRef.current.onStop(blob, blobMime);
    };

    recorder.start();
    setIsRecording(true);
    setRecordingSeconds(0);
    tickRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    maxTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, maxRecordingMs);
  }, [maxRecordingMs]); // cbRef is a stable ref object — no need to list

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  return { isRecording, recordingSeconds, start, stop };
}
