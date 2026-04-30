"use client";

import { useRef, useState } from "react";
import {
  MessageCircle,
  Plus,
  Trash2,
  Search,
  Clock,
  Pencil,
  Check,
  X,
} from "lucide-react";
import type { Session } from "@/lib/api";

interface Props {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
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

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  tier = "free",
}: Props) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? sessions.filter((s) =>
        s.title.toLowerCase().includes(query.toLowerCase())
      )
    : sessions;

  const startEdit = (session: Session) => {
    setEditingId(session.id);
    setEditValue(session.title);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = (sessionId: string) => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== sessions.find((s) => s.id === sessionId)?.title) {
      onRename(sessionId, trimmed);
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <div className="w-64 shrink-0 border-r border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-zinc-950 flex flex-col h-full">

      {/* ── Header ── */}
      <div className="px-4 pt-5 pb-4 border-b border-zinc-200 dark:border-white/[0.06] space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-[#1c0900] border border-amber-200/60 dark:border-amber-900/30 flex items-center justify-center shrink-0">
            <MessageCircle size={15} className="text-amber-800 dark:text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">Sessions</p>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
              {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <button
          onClick={onCreate}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium active:scale-[0.98] transition-all text-amber-50 bg-amber-800 hover:bg-amber-900 dark:bg-gradient-to-b dark:from-[#713f12] dark:to-[#2e1008] dark:hover:from-[#854d0e] dark:hover:to-[#3d1509] border border-amber-700/30 dark:border-white/10"
        >
          <Plus size={13} />
          New Session
        </button>

        {sessions.length > 3 && (
          <div className="relative">
            <Search
              size={11}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/[0.06] rounded-lg text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:ring-1 focus:ring-amber-500/40 dark:focus:ring-amber-700/40 transition"
            />
          </div>
        )}
      </div>

      {/* ── Session list ── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-3 mt-10 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 flex items-center justify-center">
              <MessageCircle size={18} className="text-zinc-300 dark:text-zinc-700" />
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">No sessions yet</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5 leading-relaxed">
                Start a new session to begin.
              </p>
            </div>
          </div>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center mt-6 px-3">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}

        {filtered.map((session) => {
          const isActive = session.id === activeSessionId;
          const isEditing = editingId === session.id;

          return (
            <div
              key={session.id}
              onClick={() => !isEditing && onSelect(session.id)}
              className={`group relative flex items-start gap-2 rounded-lg px-2.5 py-2.5 cursor-pointer transition-all ${
                isActive
                  ? "bg-amber-50 dark:bg-[#130800] border border-amber-200 dark:border-[#3d1a00]/60 shadow-sm"
                  : "border border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/70 hover:border-zinc-200 dark:hover:border-white/[0.05]"
              }`}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-amber-600" />
              )}

              <div className="flex-1 min-w-0 pl-1">
                {isEditing ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(session.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 min-w-0 text-xs font-medium bg-amber-50 dark:bg-[#1c0900] border border-amber-300 dark:border-amber-800/60 rounded px-1.5 py-0.5 text-zinc-800 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-amber-500/40"
                      autoFocus
                    />
                    <button
                      onClick={() => commitEdit(session.id)}
                      className="text-amber-700 dark:text-amber-500 hover:text-amber-800 dark:hover:text-amber-400 shrink-0"
                      aria-label="Save"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0"
                      aria-label="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <p
                    className={`text-xs font-medium truncate leading-snug ${
                      isActive
                        ? "text-amber-900 dark:text-amber-200"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {session.title}
                  </p>
                )}
                {!isEditing && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock size={9} className="text-zinc-300 dark:text-zinc-700 shrink-0" />
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
                      {relativeTime(session.updated_at)}
                    </span>
                  </div>
                )}
              </div>

              {/* Action buttons — visible on hover or when active */}
              {!isEditing && (
                <div
                  className={`flex items-center gap-0.5 shrink-0 mt-0.5 transition-opacity ${
                    isActive
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => startEdit(session)}
                    className="p-1 rounded text-zinc-400 hover:text-amber-700 dark:hover:text-amber-500 hover:bg-amber-100 dark:hover:bg-[#1c0900] transition-colors"
                    aria-label="Rename session"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => onDelete(session.id)}
                    className="p-1 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    aria-label="Delete session"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-zinc-200 dark:border-white/[0.06]">
        {tier === "free" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
                Free plan · 5 messages/day
              </span>
              <span className="text-[9px] text-zinc-400 dark:text-zinc-700">resets midnight</span>
            </div>
            <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-0.5">
              <div className="bg-amber-500 dark:bg-amber-700 h-0.5 rounded-full w-0" />
            </div>
            <a
              href="/dashboard"
              className="block text-center text-[10px] font-medium text-amber-700 dark:text-amber-500 hover:underline"
            >
              Upgrade to Pro — unlimited messages ↗
            </a>
          </div>
        ) : (
          <div className="text-center space-y-0.5">
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-500">
              Pro plan · Unlimited
            </p>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
              All features unlocked
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
