"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, type SubscriptionError } from "@/lib/api";
import { useMediaRecorder } from "./useMediaRecorder";

export type VoiceState = "idle" | "recording" | "processing";

/**
 * Transcription-only voice hook for the chat MessageInput bar.
 * Records audio → calls /voice/transcribe → invokes onTranscript with the text.
 *
 * The underlying MediaRecorder lifecycle (getUserMedia, timers, cleanup, codec
 * selection, auto-stop) is fully managed by useMediaRecorder.
 */
export function useVoice(
  onTranscript: (text: string) => void,
  onSubscriptionError?: (err: SubscriptionError) => void,
) {
  const { getToken } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight transcription request on unmount.
  useEffect(() => () => { fetchAbortRef.current?.abort(); }, []);

  const handleStop = useCallback(async (blob: Blob) => {
    setIsProcessing(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const abort = new AbortController();
      fetchAbortRef.current = abort;
      const result = await api.transcribeAudio(token, blob, abort.signal);
      fetchAbortRef.current = null;
      if (result.transcript) onTranscript(result.transcript);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
      if (subErr && onSubscriptionError) {
        onSubscriptionError(subErr);
      } else {
        // Prefer the backend's own message (e.g. "Recording was too short") over
        // a hardcoded fallback; fall back only when the message looks like a raw
        // HTTP status string ("4xx: …") or is absent.
        const msg = err instanceof Error ? err.message : "";
        setError(
          msg && !msg.match(/^\d{3}:/)
            ? msg
            : "Transcription failed. Please try again.",
        );
      }
    } finally {
      setIsProcessing(false);
    }
  }, [getToken, onTranscript, onSubscriptionError]);

  const { isRecording, recordingSeconds, start, stop } = useMediaRecorder({
    onStop: handleStop,
    onError: (msg) => setError(msg),
  });

  // Derive a single tri-state from the two independent flags.
  const state: VoiceState = isRecording ? "recording" : isProcessing ? "processing" : "idle";

  return { state, error, recordingSeconds, startRecording: start, stopRecording: stop };
}
