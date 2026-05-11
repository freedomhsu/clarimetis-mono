"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Mic, Volume2, VolumeX, RefreshCw } from "lucide-react";
import { api, type Session } from "@/lib/api";
import { useVoiceConversation, type Turn } from "@/lib/hooks/useVoiceConversation";
import { CrisisBanner, CrisisAlert } from "@/components/ui/CrisisBanner";
import { formatTime } from "@/lib/voice-utils";

function TurnBubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} gap-2`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0 mt-0.5">
          <Volume2 size={13} className="text-indigo-600 dark:text-indigo-400" />
        </div>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-indigo-600 text-white rounded-tr-sm"
            : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm rounded-tl-sm"
        }`}
      >
        {turn.text}
      </div>
    </div>
  );
}

type UIState = "loading" | "ready" | "error";

export default function VoicePage() {
  const { getToken, isLoaded } = useAuth();
  const [uiState, setUiState] = useState<UIState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Create or reuse the most recent voice session on mount
  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const sessions = await api.getSessions(token);
        // Reuse the first session tagged as a voice session, or create one
        const existing = sessions.find((s) => s.title.startsWith("Voice —"));
        if (existing) {
          setSession(existing);
        } else {
          const s = await api.createSession(token, `Voice — ${new Date().toLocaleDateString()}`);
          setSession(s);
        }
        setUiState("ready");
      } catch {
        setUiState("error");
      }
    })();
  }, [isLoaded, getToken]);

  const {
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
  } = useVoiceConversation(session?.id ?? "");

  // Auto-scroll transcript
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  if (uiState === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-sm">
        Setting up your voice session…
      </div>
    );
  }

  if (uiState === "error") {
    return (
      <div className="flex h-full items-center justify-center text-red-500 text-sm">
        Failed to start voice session. Please refresh.
      </div>
    );
  }

  const isIdle = convState === "idle" || convState === "error";
  const isRecording = convState === "recording";
  const isThinking = convState === "thinking";
  const isSpeaking = convState === "speaking";

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.05] bg-white dark:bg-[#0c0c18] shrink-0">
        <h1 className="font-semibold text-gray-900 dark:text-white text-base">Voice Session</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          {session?.title ?? "Loading…"}
        </p>
      </div>

      {hasCrisis && <CrisisAlert />}

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-5 space-y-3"
      >
        {turns.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 select-none">
            <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Mic size={28} className="text-indigo-500" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs leading-relaxed">
              Tap the microphone, speak your thoughts, and the AI will respond with voice.
            </p>
          </div>
        )}
        {turns.map((turn, i) => (
          <TurnBubble key={i} turn={turn} />
        ))}
        {/* Live "thinking" indicator */}
        {isThinking && (
          <div className="flex justify-start gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
              <Volume2 size={13} className="text-indigo-400 animate-pulse" />
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex gap-1 items-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400 dark:bg-indigo-500"
                  style={{ animation: `bounce 1s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error banner — uses subscriptionError/error directly from the hook
           so reset() reliably clears both and dismisses the banner. */}
      {(error || subscriptionError) && (
        <div className="mx-4 mb-2 px-4 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs flex items-center justify-between">
          <span>{subscriptionError?.message ?? error}</span>
          <button onClick={reset} className="ml-3 underline text-xs">Dismiss</button>
        </div>
      )}

      {/* Controls */}
      <div className="shrink-0 px-6 py-5 border-t border-slate-200 dark:border-white/[0.05] bg-white dark:bg-[#0c0c18]">
        <div className="flex flex-col items-center gap-3">

          {/* State label */}
          <p className="text-xs text-gray-400 h-4">
            {isRecording && (
              <span className="text-red-500 font-medium">
                Recording — {formatTime(recordingSeconds)} — tap to send
              </span>
            )}
            {isThinking && "Thinking…"}
            {isSpeaking && "AI is speaking — tap to stop"}
            {isIdle && !audioBlocked && turns.length > 0 && "Tap to speak again"}
          </p>

          {/* Tap-to-play fallback when browser autoplay was blocked */}
          {audioBlocked && (
            <button
              onClick={resumeAudio}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium shadow-lg shadow-indigo-500/30 transition-all active:scale-95"
            >
              <Volume2 size={16} />
              Tap to hear response
            </button>
          )}

          {/* Main mic button */}
          {isIdle && !audioBlocked && (
            <button
              onClick={startRecording}
              disabled={!session}
              className="w-16 h-16 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white shadow-lg shadow-indigo-500/30 flex items-center justify-center transition-all active:scale-95"
              aria-label="Start speaking"
            >
              <Mic size={26} />
            </button>
          )}

          {isRecording && (
            <button
              onClick={stopRecording}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/30 flex items-center justify-center transition-all active:scale-95 animate-pulse"
              aria-label="Stop recording"
            >
              {/* Waveform bars */}
              <span className="flex items-end gap-[3px] h-6" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-white"
                    style={{
                      height: "100%",
                      animation: `voiceBar 0.7s ease-in-out ${i * 0.12}s infinite alternate`,
                    }}
                  />
                ))}
              </span>
            </button>
          )}

          {isThinking && (
            <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
              <RefreshCw size={22} className="text-indigo-500 animate-spin" />
            </div>
          )}

          {isSpeaking && (
            <button
              onClick={stopSpeaking}
              className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/40 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center transition-all active:scale-95"
              aria-label="Stop AI speaking"
            >
              <VolumeX size={24} />
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes voiceBar {
          from { transform: scaleY(0.2); }
          to   { transform: scaleY(1); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-5px); }
        }
      `}</style>
      <CrisisBanner />
    </div>
  );
}
