"use client";

import { useState } from "react";
import {
  MessageCircle,
  Plus,
  Trash2,
  Search,
  Clock,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import type { Session } from "@/lib/api";

interface Props {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
  tier?: "free" | "pro";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const sessionColors = [
  { dot: "bg-violet-500", ring: "ring-violet-200 dark:ring-violet-800", bg: "bg-violet-600" },
  { dot: "bg-sky-500",    ring: "ring-sky-200 dark:ring-sky-800",       bg: "bg-sky-600" },
  { dot: "bg-emerald-500",ring: "ring-emerald-200 dark:ring-emerald-800",bg: "bg-emerald-600" },
  { dot: "bg-pink-500",   ring: "ring-pink-200 dark:ring-pink-800",     bg: "bg-pink-600" },
  { dot: "bg-amber-500",  ring: "ring-amber-200 dark:ring-amber-800",   bg: "bg-amber-600" },
  { dot: "bg-teal-500",   ring: "ring-teal-200 dark:ring-teal-800",     bg: "bg-teal-600" },
];

export function SessionList({ sessions, activeSessionId, onSelect, onCreate, onDelete, tier = "free" }: Props) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
    : sessions;

  return (
    <div className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col h-full">

      {/* ── Header ── */}
      <div className="px-4 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center shrink-0 shadow-md shadow-brand-100 dark:shadow-brand-900/30">
            <MessageCircle size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-white leading-tight">Chat Sessions</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <button
          onClick={onCreate}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-gradient-to-r from-brand-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:from-brand-700 hover:to-violet-700 active:scale-[0.98] transition-all shadow-sm shadow-brand-200 dark:shadow-brand-900/30"
        >
          <Plus size={15} />
          New Session
        </button>

        {sessions.length > 3 && (
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none focus:ring-1 focus:ring-brand-400 dark:focus:ring-brand-500 transition"
            />
          </div>
        )}
      </div>

      {/* ── Session list ── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">

        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-3 mt-10 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
              <Sparkles size={20} className="text-gray-400 dark:text-gray-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">No sessions yet</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">
                Start a new session to begin your coaching journey.
              </p>
            </div>
          </div>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center mt-6 px-3">
            No sessions match &ldquo;{query}&rdquo;
          </p>
        )}

        {filtered.map((session, i) => {
          const isActive = session.id === activeSessionId;
          const color = sessionColors[i % sessionColors.length];

          return (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`group relative flex items-start gap-2.5 rounded-xl px-3 py-3 cursor-pointer transition-all ${
                isActive
                  ? "bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 shadow-sm"
                  : "border border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/70 hover:border-gray-200 dark:hover:border-gray-700"
              }`}
            >
              <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ring-2 ${
                isActive ? `${color.bg} ${color.ring}` : "bg-gray-100 dark:bg-gray-800 ring-transparent"
              }`}>
                <MessageCircle
                  size={13}
                  className={isActive ? "text-white" : "text-gray-400 dark:text-gray-500"}
                />
              </div>

              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold truncate leading-snug ${
                  isActive ? "text-brand-700 dark:text-brand-300" : "text-gray-700 dark:text-gray-200"
                }`}>
                  {session.title}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock size={9} className="text-gray-400 dark:text-gray-600 shrink-0" />
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {relativeTime(session.updated_at)}
                  </span>
                </div>
              </div>

              {isActive ? (
                <ChevronRight size={13} className="text-brand-400 dark:text-brand-500 shrink-0 mt-1" />
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-all shrink-0 mt-1"
                  aria-label="Delete session"
                >
                  <Trash2 size={13} />
                </button>
              )}

              {isActive && (
                <span className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full ${color.dot}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer hint ── */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
        {tier === "free" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Free plan · 5 messages/day
              </span>
              <span className="text-[9px] text-gray-400 dark:text-gray-600">resets midnight</span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1">
              <div className="bg-amber-400 dark:bg-amber-500 h-1 rounded-full w-0" />
            </div>
            <a
              href="/dashboard"
              className="block text-center text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
            >
              Upgrade to Pro — unlimited messages ↗
            </a>
          </div>
        ) : (
          <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center leading-relaxed">
            Each session has its own memory &amp; context
          </p>
        )}
      </div>
    </div>
  );
}
