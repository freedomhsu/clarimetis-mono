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
  RotateCcw,
} from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { useAuth, useUser } from "@clerk/nextjs";
import { useChat } from "@/lib/hooks/useChat";
import { useDashboard } from "@/components/providers/DashboardContext";
import { api, type Message, type SubscriptionError } from "@/lib/api";

const trustSignals = [
  { icon: ShieldCheck,   label: "Secure" },
  { icon: Fingerprint,   label: "Personalized" },
  { icon: Brain,         label: "Cognitive insights" },
  { icon: Globe,         label: "Any language" },
  { icon: HeartHandshake,label: "Crisis-aware" },
  { icon: Zap,           label: "Always on" },
];

const starterPrompts = [
  { icon: Sparkles, text: "I've been feeling overwhelmed lately…" },
  { icon: Brain, text: "Help me understand a pattern in my thinking" },
  { icon: MessageCircle, text: "I'd like to set a goal for this week" },
];

/** Shows the live agent status message while thinking. */
function ThinkingIndicator({ status }: { status: string }) {
  return (
    <div className="flex justify-start mb-5 items-start">
      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 mr-2.5 mt-0.5 shadow-md shadow-indigo-900/20">
        <Brain size={13} className="text-white" />
      </div>
      <div className="bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2.5">
        <span className="flex gap-1 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:300ms]" />
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-500">
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
  /** Called whenever the loading/streaming state changes so the parent can
   * show a per-session indicator in the sidebar. */
  onLoadingChange?: (isLoading: boolean) => void;
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
  const isRateLimit = error.code === "rate_limit_exceeded";
  const isLimit = error.code === "daily_limit_reached";

  // Rate-limit errors: just a dismissible notice, no upgrade prompt.
  if (isRateLimit) {
    return (
      <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 pt-4 pb-3">
        <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Slow down a bit
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {error.message}
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
      </div>
    );
  }

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

export function ChatWindow({ sessionId, sessionTitle, tier = "free", onLoadingChange }: Props) {
  const { isLoaded: clerkLoaded } = useAuth();
  const { user: clerkUser } = useUser();
  const { messages, isLoading, streamingContent, thinkingStatus, subscriptionError, setSubscriptionError, sendError, setSendError, loadMessages, sendMessage, regenerate, stopGeneration } =
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

  // Notify parent when loading state changes so it can show a per-session
  // indicator in the sidebar even while this window is hidden.
  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  return (
    <div className="flex flex-col h-full">

      {/* ── Persistent header ── */}
      <div className="shrink-0 relative overflow-hidden bg-white dark:bg-[#0c0c18]">
        {/* Ambient depth layers (dark mode only) */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 w-40 h-full bg-gradient-to-r from-indigo-600/[0.06] to-transparent" />
          <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-violet-600/[0.05] to-transparent" />
          <div className="absolute -top-3 left-12 w-20 h-10 rounded-full bg-indigo-500/10 blur-2xl" />
        </div>

        {/* Bottom border — gradient fade for depth */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 dark:via-indigo-500/30 to-transparent" />

        {/* Main title row */}
        <div className="relative flex items-center gap-3 px-5 pt-4 pb-2.5">
          {/* Icon — larger with layered glow */}
          <div className="relative shrink-0">
            <div className="absolute -inset-1.5 rounded-2xl bg-gradient-to-br from-indigo-500/35 to-violet-600/35 blur-xl" />
            <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-xl shadow-indigo-900/30 ring-1 ring-white/[0.12]">
              <Brain size={18} className="text-white drop-shadow" />
            </div>
          </div>

          {/* Title + tagline */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-100 truncate">
                {sessionTitle || "Coaching Session"}
              </p>
              {tier === "free" && (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 text-indigo-400 dark:text-indigo-500 uppercase tracking-widest">
                  <Lock size={7} />
                  Free
                </span>
              )}
            </div>
            <p className="text-[11px] font-semibold tracking-wide bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent truncate">
              End Social Fear, Talk Freely
            </p>
          </div>

          {/* Live badge */}
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full bg-emerald-400/25 blur-md" />
            <span className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/50 dark:border-emerald-700/40 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/60" />
              Live
            </span>
          </div>
        </div>

        {/* Trust signals — icon-in-box + label, pipe-separated */}
        <div className="relative px-5 pb-4 flex items-center overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {trustSignals.map(({ icon: Icon, label }, i) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-default${i > 0 ? " ml-3 pl-3 border-l border-slate-200 dark:border-white/[0.08]" : ""}`}
            >
              <span className="w-[18px] h-[18px] rounded-md bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-100 dark:border-indigo-800/50 flex items-center justify-center shrink-0">
                <Icon size={9} className="text-indigo-500 dark:text-indigo-400" />
              </span>
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
                {label}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 bg-slate-50 dark:bg-[#080810]">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 max-w-sm mx-auto">
            {/* Hero icon with ambient glow */}
            <div className="relative mb-6">
              <div className="absolute -inset-6 rounded-full bg-gradient-to-br from-indigo-500/10 to-violet-500/10 blur-3xl" />
              <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-500/25 flex items-center justify-center">
                <Brain size={32} className="text-white" />
              </div>
            </div>

            {/* Headline */}
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2 leading-tight">
              End Social Fear,{" "}
              <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">
                Talk Freely
              </span>
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-500 mb-7 leading-relaxed max-w-xs">
              Your private AI mental wellness coach — no judgment, always on, completely yours.
            </p>

            {/* Feature chips */}
            <div className="flex flex-wrap justify-center gap-1.5 mb-7">
              {trustSignals.map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 text-[10px] font-medium text-slate-600 dark:text-slate-400 shadow-sm">
                  <Icon size={9} className="text-indigo-500 dark:text-indigo-400" />
                  {label}
                </span>
              ))}
            </div>

            {/* Starter prompts */}
            <div className="w-full space-y-2">
              {starterPrompts.map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  onClick={() => sendMessage(text)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-white dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 rounded-xl text-sm text-left text-slate-600 dark:text-slate-400 hover:border-indigo-300 dark:hover:border-indigo-700/60 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 transition-all duration-150 group shadow-sm"
                >
                  <span className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/40 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
                    <Icon size={13} className="text-indigo-500 dark:text-indigo-400" />
                  </span>
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isLastAssistant =
            !isLoading &&
            msg.role === "assistant" &&
            idx === messages.length - 1;
          // Find the most recent user message before this assistant reply.
          const prevUserMsg = isLastAssistant
            ? [...messages].slice(0, idx).reverse().find((m) => m.role === "user")
            : undefined;
          return (
            <div key={msg.id}>
              <MessageBubble message={msg} userImageUrl={clerkUser?.imageUrl} />
              {isLastAssistant && prevUserMsg && (
                <div className="flex justify-start pl-10 -mt-3 mb-4">
                  <button
                    onClick={() => regenerate(msg.id, prevUserMsg.id, prevUserMsg.content)}
                    className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                    title="Regenerate response"
                  >
                    <RotateCcw size={11} />
                    Regenerate
                  </button>
                </div>
              )}
            </div>
          );
        })}

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
