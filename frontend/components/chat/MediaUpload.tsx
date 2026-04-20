"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { api, SubscriptionError } from "@/lib/api";

interface Props {
  onUpload: (url: string) => void;
  disabled?: boolean;
  onSubscriptionError?: (err: SubscriptionError) => void;
}

export function MediaUpload({ onUpload, disabled, onSubscriptionError }: Props) {
  const { getToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = await getToken();
    if (!token) return;
    try {
      const result = await api.uploadMedia(token, file);
      onUpload(result.url);
    } catch (err) {
      const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
      if (subErr && onSubscriptionError) {
        onSubscriptionError(subErr);
      } else {
        alert("Failed to upload file. Please try again.");
      }
    }
    e.target.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        aria-label="Attach image or video"
      >
        <Paperclip size={17} />
      </button>
    </>
  );
}
