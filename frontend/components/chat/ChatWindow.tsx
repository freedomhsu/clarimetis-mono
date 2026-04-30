"use client";

import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck,
  Brain,
  Globe,
  HeartHandshake,
  Sparkles,
  Fingerprint,
  Zap,
  MessageCircle,
  AlertTriangle,
  Loader2,
  Lock,
} from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { useAuth } from "@clerk/nextjs";
import { useChat } from "@/lib/hooks/useChat";
import { useDashboard } from "@/components/providers/DashboardContext";
import { api, type Message, type SubscriptionError } from "@/lib/api";

const trustSignals = [
  {
    icon: ShieldCheck,
    label: "Secure",
    iconColor: "text-stone-500 dark:text-stone-400",
  },
  {
    icon: Fingerprint,
    label: "Personalized",
    iconColor: "text-stone-500 dark:text-stone-400",
  },
  {
    icon: Brain,
    label: "Cognitive insights",
    iconColor: "text-stone-500 dark:text-stone-400",
  },
  {
    icon: Globe,
    label: "Any language",
    iconColor: "text-stone-500 dark:text-stone-400",
  },
  {
    icon: HeartHandshake,
    label: "Crisis-aware",
    iconColor: "text-stone-500 dark:text-stone-400",
  },
  {
    icon: Zap,
    label: "Always on",
    iconColor: "text-stone-500 dark:text-stone-400",
  },
];

const starterPrompts = [
  { icon: Sparkles, text: "I've been feeling overwhelmed lately…" },
  { icon: Brain, text: "Help me understand a pattern in my thinking" },
  { icon: MessageCircle, text: "I'd like to set a goal for this week" },
];

/** Shows the live agent status message while thinking. */
function ThinkingIndicator({ status }: { status: string }) {
  return (
    <div className="flex justify-start mb-4">
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 min-w-[200px] shadow-sm">
        <span className="flex gap-1 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:300ms]" />
        </span>
        <span className="text-xs text-stone-400 dark:text-stone-500">
          {status || "Thinking…"}
        </span>
      </div>
    </div>
  );
}

interface Props {
  sessionId: string;
  sessionTitle?: string;
  tier?: "free" | "pro";
  onSend?: (content: string) => void;
}

/** Renders a temporary streaming bubble while the assistant is typing. */
function StreamingBubble({ content }: { content: string }) {
  const fakeMessage: Message = {
    id: "streaming",
    session_id: "",
    role: "assistant",
    content,
    media_urls: null,
    crisis_flagged: false,
    created_at: new Date().toISOString(),
  };
  return <MessageBubble message={fakeMessage} />;
}

/** Shown in place of MessageInput when a quota/subscription error has been hit. */
function UpgradeGate({
  error,
  onDismiss,
}: {
  error: SubscriptionError;
  onDismiss: () => void;
}) {
  const { subscribe, billingLoading, billingError } = useDashboard();
  const isLimit = error.code === "daily_limit_reached";

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 pt-4 pb-3">
      <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 mb-3">
        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {isLimit ? "Daily limit reached" : "Pro feature"}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            {isLimit
              ? "Free plan includes 5 messages per day. Upgrade to Pro for unlimited access."
              : "This feature requires a Pro subscription."}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 text-lg leading-none shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {billingError && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-2 px-1">{billingError}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => subscribe("monthly")}
          disabled={billingLoading !== null}
          className="flex items-center justify-between gap-2 px-4 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-60 transition-colors"
        >
          <span>Pro Monthly</span>
          <span className="flex items-center gap-1">
            {billingLoading === "monthly" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <span className="font-bold">$9.99/mo</span>
            )}
          </span>
        </button>

        <button
          onClick={() => subscribe("annual")}
          disabled={billingLoading !== null}
          className="flex items-center justify-between gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors"
        >
          <span>
            Pro Annual{" "}
            <span className="text-[10px] font-bold bg-white/20 px-1 py-0.5 rounded-full">
              Save $20
            </span>
          </span>
          <span className="flex items-center gap-1">
            {billingLoading === "annual" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <span className="font-bold">$99.99/yr</span>
            )}
          </span>
        </button>
      </div>

      <p className="text-[11px] text-gray-400 text-center mt-2">
        AI coach — not a therapist. Crisis? Call/text&nbsp;<strong>988</strong>.
      </p>
    </div>
  );
}

export function ChatWindow({ sessionId, sessionTitle, tier = "free" }: Props) {
  const { isLoaded: clerkLoaded } = useAuth();
  const { messages, isLoading, streamingContent, thinkingStatus, subscriptionError, setSubscriptionError, sendError, setSendError, loadMessages, sendMessage, stopGeneration } =
    useChat(sessionId);
  const [dismissedError, setDismissedError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Reset dismiss flag when a new error arrives
  useEffect(() => {
    if (subscriptionError) setDismissedError(false);
  }, [subscriptionError]);

  return (
    <div className="flex flex-col h-full">

      {/* ── Persistent header ── */}
      <div className="shrink-0 border-b border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-950 px-4 py-3">
        {/* Session title row */}
        <div className="flex items-center gap-2 mb-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <MessageCircle size={14} className="text-amber-700 dark:text-amber-400" />
          </div>
          <span className="text-sm font-semibold text-stone-800 dark:text-stone-100 truncate">
            {sessionTitle || "Coaching Session"}
          </span>
          {tier === "free" && (
            <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[10px] font-medium text-stone-500 dark:text-stone-400">
              <Lock size={8} />
              Free · 5/day
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[10px] font-medium text-stone-500 dark:text-stone-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>

        {/* Trust signal pills — muted, quality feel */}
        <div className="flex gap-1.5 flex-wrap">
          {trustSignals.map(({ icon: Icon, label, iconColor }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-[10px] font-medium text-stone-500 dark:text-stone-400"
            >
              <Icon size={9} className={iconColor} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-stone-50 dark:bg-stone-950">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-8 px-4 max-w-md mx-auto">
            <div>
              <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
                <Brain size={24} className="text-amber-700 dark:text-amber-400" />
              </div>
              <p className="text-base font-semibold text-stone-700 dark:text-stone-200">
                How are you doing today?
              </p>
              <p className="text-sm text-stone-400 dark:text-stone-500 mt-1">
                Share what&apos;s on your mind — I&apos;m here to listen and help.
              </p>
            </div>

            {/* Starter prompts */}
            <div className="w-full space-y-2">
              {starterPrompts.map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  onClick={() => sendMessage(text)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl text-sm text-left text-stone-500 dark:text-stone-400 hover:border-amber-300 dark:hover:border-amber-700 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                >
                  <Icon size={14} className="text-amber-600 dark:text-amber-500 shrink-0" />
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && streamingContent && (
          <StreamingBubble content={streamingContent} />
        )}

        {isLoading && !streamingContent && <ThinkingIndicator status={thinkingStatus} />}

        <div ref={bottomRef} />
      </div>

      {subscriptionError && !dismissedError ? (
        <UpgradeGate
          error={subscriptionError}
          onDismiss={() => setDismissedError(true)}
        />
      ) : (
        <div>
          {sendError && (
            <div className="mx-4 mb-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 flex items-center justify-between gap-3">
              <p className="text-sm text-red-700 dark:text-red-400">{sendError}</p>
              <button
                onClick={() => setSendError(null)}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-200 text-lg leading-none shrink-0"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}
          <MessageInput onSend={sendMessage} onStop={stopGeneration} isStreaming={isLoading} disabled={!clerkLoaded} onSubscriptionError={setSubscriptionError} />
        </div>
      )}
    </div>
  );
}
