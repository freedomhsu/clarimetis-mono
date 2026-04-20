"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, SubscriptionError } from "@/lib/api";

type VoiceState = "idle" | "recording" | "processing";

export function useVoice(
  onTranscript: (text: string) => void,
  onSubscriptionError?: (err: SubscriptionError) => void,
) {
  const { getToken } = useAuth();
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Stop the recorder and release the microphone if the component unmounts
  // while a recording is in progress.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        // Detach onstop so transcription isn't attempted on an unmounted component
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer webm/opus; fall back to browser default
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setState("processing");
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        try {
          const token = await getToken();
          if (!token) throw new Error("Not authenticated");
          const result = await api.transcribeAudio(token, blob);
          if (result.transcript) {
            onTranscript(result.transcript);
          }
        } catch (err) {
          const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
          if (subErr && onSubscriptionError) {
            onSubscriptionError(subErr);
          } else {
            setError("Transcription failed. Please try again.");
          }
        } finally {
          setState("idle");
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch {
      setError("Microphone access denied.");
      setState("idle");
    }
  }, [getToken, onTranscript]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  return { state, error, startRecording, stopRecording };
}
