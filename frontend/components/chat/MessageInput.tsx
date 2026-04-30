"use client";

import { KeyboardEvent, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { MediaUpload } from "./MediaUpload";
import { VoiceRecorder } from "./VoiceRecorder";
import { SubscriptionError } from "@/lib/api";

interface Props {
  onSend: (content: string, mediaUrls?: string[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onSubscriptionError?: (err: SubscriptionError) => void;
}

export function MessageInput({ onSend, onStop, disabled, isStreaming, onSubscriptionError }: Props) {
  const [content, setContent] = useState("");
  const [pendingMedia, setPendingMedia] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && (content.trim().length > 0 || pendingMedia.length > 0);

  const handleSend = () => {
    if (!canSend) return;
    onSend(content.trim(), pendingMedia.length > 0 ? pendingMedia : undefined);
    setContent("");
    setPendingMedia([]);
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  };

  const handleTranscript = (text: string) => {
    setContent((prev) => (prev ? `${prev} ${text}` : text));
    textareaRef.current?.focus();
  };

  return (
    <div className="bg-stone-50 dark:bg-stone-950 border-t border-stone-200/60 dark:border-stone-800 px-4 pt-2 pb-3">
      {/* Pending media previews */}
      {pendingMedia.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-1">
          {pendingMedia.map((url, i) => (
            <div key={i} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-16 w-16 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
              />
              <button
                type="button"
                onClick={() => setPendingMedia((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 dark:bg-gray-600 text-white text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove attachment"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input card */}
      <div
        className={`relative rounded-2xl border transition-all duration-150 ${
          focused
            ? "border-amber-300 dark:border-amber-700 shadow-[0_0_0_3px_rgba(217,119,6,0.10)]"
            : "border-stone-200 dark:border-stone-700"
        } bg-white dark:bg-stone-900`}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Share what's on your mind…"
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent resize-none outline-none text-sm text-stone-800 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 px-4 pt-3.5 pb-2 min-h-[48px] max-h-36 leading-relaxed"
        />

        {/* Bottom toolbar */}
        <div className="flex items-center gap-1 px-2 pb-2">
          {/* Left tools */}
          <div className="flex items-center gap-0.5">
            <MediaUpload
              onUpload={(url) => setPendingMedia((prev) => [...prev, url])}
              disabled={disabled}
              onSubscriptionError={onSubscriptionError}
            />
            <VoiceRecorder onTranscript={handleTranscript} disabled={disabled} onSubscriptionError={onSubscriptionError} />
          </div>

          {/* Spacer + hint */}
          <span className="flex-1 text-center text-[10px] text-gray-400 dark:text-gray-600 select-none pointer-events-none">
            {content.length > 0 ? (
              <span className="text-gray-400 dark:text-gray-500">
                Enter&nbsp;to send&nbsp;·&nbsp;Shift+Enter for new line
              </span>
            ) : null}
          </span>

          {/* Send / Stop button */}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generation"
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-red-500 hover:bg-red-600 text-white shadow-sm transition-all duration-150 scale-100 hover:scale-105"
            >
              <Square size={13} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-150 ${
                canSend
                  ? "bg-amber-700 hover:bg-amber-800 dark:bg-amber-800 dark:hover:bg-amber-700 text-white shadow-sm scale-100 hover:scale-105"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-300 dark:text-stone-600 cursor-not-allowed"
              }`}
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center mt-1.5 leading-tight">
        AI coach — not a therapist. In crisis? Call or text&nbsp;<strong className="text-gray-500 dark:text-gray-400">988</strong>.
      </p>
    </div>
  );
}
