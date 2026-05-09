"use client";

import { KeyboardEvent, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { MediaUpload } from "./MediaUpload";
import { VoiceRecorder } from "./VoiceRecorder";
import { SubscriptionError } from "@/lib/api";
import { useI18n } from "@/components/providers/I18nContext";

interface Props {
  onSend: (content: string, blobPaths?: string[], previewUrls?: string[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onSubscriptionError?: (err: SubscriptionError) => void;
}

export function MessageInput({ onSend, onStop, disabled, isStreaming, onSubscriptionError }: Props) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [pendingMedia, setPendingMedia] = useState<{ previewUrl: string; blobPath: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && !isUploading && (content.trim().length > 0 || pendingMedia.length > 0);

  const handleSend = () => {
    if (!canSend) return;
    const blobPaths = pendingMedia.length > 0 ? pendingMedia.map((m) => m.blobPath) : undefined;
    const previewUrls = pendingMedia.length > 0 ? pendingMedia.map((m) => m.previewUrl) : undefined;
    onSend(content.trim(), blobPaths, previewUrls);
    setContent("");
    setPendingMedia([]);
    setUploadError(null);
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
    <div className="bg-white dark:bg-[#0c0c18] border-t border-slate-200 dark:border-white/[0.05] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_-8px_32px_rgba(0,0,0,0.4)]">
      {/* Pending media previews + upload spinner */}
      {(pendingMedia.length > 0 || isUploading) && (
        <div className="flex flex-wrap gap-2 mb-2 px-1">
          {pendingMedia.map((item) => (
            <div key={item.blobPath} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt=""
                className="h-16 w-16 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
              />
              <button
                type="button"
                onClick={() => setPendingMedia((prev) => prev.filter((m) => m.blobPath !== item.blobPath))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 dark:bg-gray-600 text-white text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove attachment"
              >
                ×
              </button>
            </div>
          ))}
          {isUploading && (
            <div className="h-16 w-16 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 text-indigo-400 dark:text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-500 dark:text-red-400 px-1 mb-2">{uploadError}</p>
      )}

      {/* Input card */}
      <div
        className={`relative rounded-2xl border transition-all duration-200 ${
          focused
            ? "border-indigo-400/70 dark:border-indigo-600/50 shadow-[0_0_0_3px_rgba(99,102,241,0.12)] dark:shadow-[0_0_0_4px_rgba(99,102,241,0.20)] bg-white dark:bg-[#16162a]"
            : "border-slate-200 dark:border-indigo-900/40 bg-slate-50 dark:bg-[#13131f]"
        }`}
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
          placeholder={t("chat_placeholder")}
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent resize-none outline-none text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 px-4 pt-3.5 pb-2 min-h-[48px] max-h-36 leading-relaxed"
        />

        {/* Bottom toolbar */}
        <div className="flex items-center gap-1 px-2 pb-2">
          {/* Left tools */}
          <div className="flex items-center gap-0.5">
            <MediaUpload
              onUploadStart={() => setIsUploading(true)}
              onUpload={(previewUrl, blobPath) => {
                setPendingMedia((prev) => [...prev, { previewUrl, blobPath }]);
                setIsUploading(false);
              }}
              onUploadError={(msg) => {
                setIsUploading(false);
                setUploadError(msg ?? null);
              }}
              disabled={disabled || isUploading}
              onSubscriptionError={(err) => {
                setIsUploading(false);
                onSubscriptionError?.(err);
              }}
            />
            <VoiceRecorder onTranscript={handleTranscript} disabled={disabled} onSubscriptionError={onSubscriptionError} />
          </div>

          {/* Spacer + hint */}
          <span className="flex-1 text-center text-[10px] text-slate-400 dark:text-slate-600 select-none pointer-events-none">
            {content.length > 0 ? (
              <span className="text-slate-400 dark:text-slate-600">
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
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500 hover:bg-red-600 text-white shadow-sm transition-all duration-150 scale-100 hover:scale-105 touch-manipulation"
            >
              <Square size={13} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-150 touch-manipulation ${
                canSend
                  ? "text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-gradient-to-br dark:from-indigo-500 dark:to-violet-600 dark:hover:from-indigo-400 dark:hover:to-violet-500 border border-indigo-400/30 dark:border-indigo-400/20 shadow-md shadow-indigo-900/20 scale-100 hover:scale-105"
                  : "bg-slate-100 dark:bg-[#1a1a2e] text-slate-300 dark:text-slate-600 cursor-not-allowed"
              }`}
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-slate-400 dark:text-slate-600 text-center mt-1.5 leading-tight">
        AI coach — not a therapist. In crisis? Call or text&nbsp;<strong className="text-slate-500 dark:text-slate-500">988</strong>.
      </p>
    </div>
  );
}
