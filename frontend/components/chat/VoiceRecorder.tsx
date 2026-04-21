"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useVoice } from "@/lib/hooks/useVoice";
import { SubscriptionError } from "@/lib/api";

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  onSubscriptionError?: (err: SubscriptionError) => void;
}

export function VoiceRecorder({ onTranscript, disabled, onSubscriptionError }: Props) {
  const { state, error, startRecording, stopRecording } = useVoice(onTranscript, onSubscriptionError);

  return (
    <div className="flex items-center">
      {state === "idle" && (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          aria-label="Start voice recording"
        >
          <Mic size={17} />
        </button>
      )}

      {state === "recording" && (
        <button
          type="button"
          onClick={stopRecording}
          className="p-1.5 rounded-lg text-red-500 bg-red-50 dark:bg-red-950/40 animate-pulse"
          aria-label="Stop recording"
        >
          <Square size={17} />
        </button>
      )}

      {state === "processing" && (
        <span className="p-1.5 text-gray-400">
          <Loader2 size={17} className="animate-spin" />
        </span>
      )}

      {error && (
        <span className="text-xs text-red-500 ml-1">{error}</span>
      )}
    </div>
  );
}
