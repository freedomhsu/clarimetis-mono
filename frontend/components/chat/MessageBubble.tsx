"use client";

import { Brain, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Message } from "@/lib/api";
import { CrisisBanner } from "@/components/ui/CrisisBanner";

interface Props {
  message: Message;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" };
  return d.toLocaleString([], opts);
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-5 items-start`}>
      {/* AI avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 mr-2.5 mt-0.5 shadow-md shadow-indigo-900/20">
          <Brain size={13} className="text-white" />
        </div>
      )}

      <div className="max-w-[72%] space-y-1">
        {message.crisis_flagged && !isUser && <CrisisBanner />}

        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-gradient-to-br from-indigo-500 to-violet-600 border border-indigo-400/20 text-white rounded-br-sm shadow-lg shadow-indigo-900/20"
              : "bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 text-slate-800 dark:text-slate-100 rounded-bl-sm"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <ReactMarkdown
              className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 dark:prose-invert"
              components={{
                // Open all links in a new tab — prevents the AI response from
                // navigating the user away from the chat, and applies the
                // noopener noreferrer security attributes to prevent the opened
                // page from accessing window.opener.
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>

        {message.media_urls && message.media_urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.media_urls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt="attachment"
                className="max-h-40 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
              />
            ))}
          </div>
        )}

        <p className={`text-[10px] text-slate-400 dark:text-slate-600 px-1 ${isUser ? "text-right" : "text-left"}`}>
          {formatTime(message.created_at)}
        </p>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-slate-400 to-slate-600 dark:from-slate-600 dark:to-slate-800 flex items-center justify-center shrink-0 ml-2.5 mt-0.5">
          <User size={13} className="text-white" />
        </div>
      )}
    </div>
  );
}
