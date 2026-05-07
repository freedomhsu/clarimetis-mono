"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { api, SubscriptionError } from "@/lib/api";

/**
 * MIME types the backend accepts (mirrors backend _ALLOWED_TYPES).
 * This single source of truth drives both client-side pre-validation
 * and the <input accept="…"> attribute, so they can never drift.
 */
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
]);

/**
 * Per-file size ceiling — must match backend max_upload_bytes (app/config.py)
 * and the Next.js proxy serverBodySizeLimit (next.config.ts).
 */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/**
 * Glob accept string for the hidden file input — broad enough to surface
 * the right files in the native picker while ALLOWED_UPLOAD_TYPES enforces
 * the exact set.
 */
const ACCEPT = "image/*,video/*,application/pdf,.pdf";

interface Props {
  onUpload: (previewUrl: string, blobPath: string) => void;
  onUploadStart?: () => void;
  onUploadError?: (message?: string) => void;
  disabled?: boolean;
  onSubscriptionError?: (err: SubscriptionError) => void;
}

export function MediaUpload({ onUpload, onUploadStart, onUploadError, disabled, onSubscriptionError }: Props) {
  const { getToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side pre-validation — reject unsupported types immediately so
    // the user gets instant feedback without burning a network round-trip.
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      onUploadError?.("Unsupported file type. Please upload an image, video, or PDF.");
      e.target.value = "";
      return;
    }

    // Client-side size check — mirrors the backend 30 MB limit.
    if (file.size > MAX_UPLOAD_BYTES) {
      onUploadError?.(`File exceeds the ${MAX_UPLOAD_MB} MB limit.`);
      e.target.value = "";
      return;
    }

    const token = await getToken();
    if (!token) return;
    onUploadStart?.();
    try {
      const result = await api.uploadMedia(token, file);
      onUpload(result.url, result.blob_path);
    } catch (err) {
      const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
      if (subErr && onSubscriptionError) {
        onSubscriptionError(subErr);
      } else {
        onUploadError?.("Failed to upload file. Please try again.");
      }
    }
    e.target.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        aria-label="Attach image, video, or PDF"
      >
        <Paperclip size={17} />
      </button>
    </>
  );
}
