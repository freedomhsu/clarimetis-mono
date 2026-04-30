"use client";

import ReactMarkdown from "react-markdown";
import type { Message } from "@/lib/api";
import { CrisisBanner } from "@/components/ui/CrisisBanner";

interface Props {
  message: Message;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className="max-w-[78%] space-y-1">
        {message.crisis_flagged && !isUser && <CrisisBanner />}

        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-amber-800 dark:bg-amber-900 text-white rounded-br-sm"
              : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-100 rounded-bl-sm shadow-sm"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <ReactMarkdown
              className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 dark:prose-invert"
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>

        <p className={`text-[10px] text-stone-400 dark:text-stone-600 px-1 ${isUser ? "text-right" : "text-left"}`}>
          {formatTime(message.created_at)}
        </p>

        {message.media_urls && message.media_urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.media_urls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt="attachment"
                className="max-h-40 rounded-lg object-cover border border-gray-200 dark:border-gray-700"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
