"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, type SubscriptionError } from "@/lib/api";
import { decodeAudioDataUri } from "@/lib/voice-utils";

export interface UseVoiceConversationOptions {
  /**
   * Override the auto-stop duration (ms).
   * Default: 120_000 (2 min).
   */
  maxRecordingMs?: number;
}

export type ConvState =
  | "idle"          // waiting for user to speak
  | "recording"     // mic active, capturing audio
  | "thinking"      // STT + Gemini + TTS in flight
  | "speaking"      // AI audio playing
  | "error";

export interface Turn {
  role: "user" | "assistant";
  text: string;
  crisis_flagged?: boolean;
}

export function useVoiceConversation(
  sessionId: string,
  { maxRecordingMs = 120_000 }: UseVoiceConversationOptions = {},
) {
  const { getToken } = useAuth();
  const [convState, setConvState] = useState<ConvState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<SubscriptionError | null>(null);

  const [audioBlocked, setAudioBlocked] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Holds the current Blob URL so we can revoke it and avoid memory leaks
  const objectUrlRef = useRef<string | null>(null);

  const _clearTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      _clearTimer();
      if (maxTimerRef.current !== null) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
      fetchAbortRef.current?.abort();
      audioRef.current?.pause();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setSubscriptionError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onerror = () => {
        _clearTimer();
        if (maxTimerRef.current !== null) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setError("Recording failed. Please try again.");
        setConvState("error");
      };

      recorder.onstop = async () => {
        _clearTimer();
        if (maxTimerRef.current !== null) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
        setRecordingSeconds(0);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        setConvState("thinking");

        try {
          const token = await getToken();
          if (!token) throw new Error("Not authenticated");

          const blobMimeType = (recorder.mimeType || "audio/webm").split(";")[0];
          const blob = new Blob(chunksRef.current, { type: blobMimeType });

          const abort = new AbortController();
          fetchAbortRef.current = abort;
          const result = await api.voiceConversation(token, sessionId, blob, abort.signal);
          fetchAbortRef.current = null;

          // Add both turns to the transcript list
          setTurns((prev) => [
            ...prev,
            { role: "user", text: result.user_transcript },
            { role: "assistant", text: result.assistant_text, crisis_flagged: result.crisis_flagged },
          ]);

          // Convert base64 data URI → Blob URL.
          // Blob URLs are more reliable than data URIs for audio across browsers
          // (avoids MIME-type ambiguity, Safari data URI size limits, etc.).
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
          }
          const audioBlob = decodeAudioDataUri(result.audio_data);
          const objectUrl = URL.createObjectURL(audioBlob);
          objectUrlRef.current = objectUrl;

          const audio = new Audio(objectUrl);
          audioRef.current = audio;
          const _releaseUrl = () => {
            URL.revokeObjectURL(objectUrl);
            // Only null the ref if it still points to this specific URL —
            // a concurrent turn may have already assigned a newer URL.
            if (objectUrlRef.current === objectUrl) objectUrlRef.current = null;
          };
          audio.onended = () => { setConvState("idle"); setAudioBlocked(false); _releaseUrl(); };
          audio.onerror  = () => { setConvState("idle"); setAudioBlocked(false); _releaseUrl(); };

          // play() is outside the main try/catch so a browser autoplay rejection
          // (NotAllowedError after a long request) doesn't surface as an error.
          setConvState("speaking");
          audio.play().catch((e: unknown) => {
            if (e instanceof DOMException && e.name === "NotAllowedError") {
              // Autoplay blocked — show tap-to-play button, keep audio buffered
              setConvState("idle");
              setAudioBlocked(true);
            } else {
              setConvState("idle");
              _releaseUrl();
            }
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
          if (subErr) {
            setSubscriptionError(subErr);
          } else {
            const msg = err instanceof Error ? err.message : null;
            setError(msg ?? "Something went wrong. Please try again.");
          }
          setConvState("error");
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setConvState("recording");
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);

      // Auto-stop after 2 minutes to prevent oversized audio blobs (> 10 MB backend limit)
      maxTimerRef.current = setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state === "recording") {
          recorderRef.current.stop();
        }
      }, maxRecordingMs);
    } catch {
      setError("Microphone access denied.");
      setConvState("error");
    }
  }, [getToken, sessionId]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    setConvState("idle");
    setAudioBlocked(false);
  }, []);

  const resumeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioBlocked(false);
    setConvState("speaking");
    audio.play().catch(() => setConvState("idle"));
  }, []);

  const reset = useCallback(() => {
    fetchAbortRef.current?.abort();
    audioRef.current?.pause();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setError(null);
    setSubscriptionError(null);
    setAudioBlocked(false);
    setConvState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // refs are stable; state setters have stable identity in React

  // Derived: true if any assistant turn was crisis-flagged by the backend.
  const hasCrisis = turns.some((t) => t.role === "assistant" && t.crisis_flagged);

  return {
    convState,
    turns,
    recordingSeconds,
    hasCrisis,
    error,
    subscriptionError,
    audioBlocked,
    startRecording,
    stopRecording,
    stopSpeaking,
    resumeAudio,
    reset,
  };
}
