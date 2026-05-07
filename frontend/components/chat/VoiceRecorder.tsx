"use client";

import { Loader2, Mic } from "lucide-react";
import { useVoice } from "@/lib/hooks/useVoice";
import { SubscriptionError } from "@/lib/api";
import { formatTime } from "@/lib/voice-utils";

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  onSubscriptionError?: (err: SubscriptionError) => void;
}

export function VoiceRecorder({ onTranscript, disabled, onSubscriptionError }: Props) {
  const { state, error, recordingSeconds, startRecording, stopRecording } = useVoice(
    onTranscript,
    onSubscriptionError,
  );

  return (
    <div className="flex items-center gap-1.5">
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
          className="flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
          aria-label="Stop recording"
          title="Tap to stop"
        >
          {/* Animated waveform bars */}
          <span className="flex items-center gap-[3px] h-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-[3px] rounded-full bg-red-500 dark:bg-red-400"
                style={{
                  height: "100%",
                  animation: `voiceBar 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                }}
              />
            ))}
          </span>
          {/* Elapsed time */}
          <span className="text-xs font-mono font-medium tabular-nums leading-none">
            {formatTime(recordingSeconds)}
          </span>
        </button>
      )}

      {state === "processing" && (
        <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs">
          <Loader2 size={13} className="animate-spin" />
          Transcribing…
        </span>
      )}

      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}

      {/* Keyframes injected inline — avoids a separate CSS file */}
      <style>{`
        @keyframes voiceBar {
          from { transform: scaleY(0.25); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
