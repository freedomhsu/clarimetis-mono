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
    <div className="w-64 shrink-0 border-r border-stone-200/80 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 flex flex-col h-full">

      {/* ── Header ── */}
      <div className="px-4 pt-5 pb-4 border-b border-stone-200/60 dark:border-stone-800 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <MessageCircle size={15} className="text-amber-700 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-100 leading-tight">Sessions</p>
            <p className="text-[10px] text-stone-400 dark:text-stone-500">
              {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <button
          onClick={onCreate}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-700 dark:bg-amber-800 text-white rounded-lg text-xs font-medium hover:bg-amber-800 dark:hover:bg-amber-700 active:scale-[0.98] transition-all"
        >
          <Plus size={13} />
          New Session
        </button>

        {sessions.length > 3 && (
          <div className="relative">
            <Search
              size={11}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-700 dark:text-stone-300 placeholder-stone-400 dark:placeholder-stone-600 outline-none focus:ring-1 focus:ring-amber-400 dark:focus:ring-amber-600 transition"
            />
          </div>
        )}
      </div>

      {/* ── Session list ── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-3 mt-10 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 flex items-center justify-center">
              <MessageCircle size={18} className="text-stone-300 dark:text-stone-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">No sessions yet</p>
              <p className="text-[11px] text-stone-400 dark:text-stone-600 mt-0.5 leading-relaxed">
                Start a new session to begin.
              </p>
            </div>
          </div>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-stone-400 dark:text-stone-600 text-center mt-6 px-3">
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
                  ? "bg-white dark:bg-stone-900 shadow-sm border border-stone-200 dark:border-stone-700"
                  : "border border-transparent hover:bg-white dark:hover:bg-stone-900/60 hover:border-stone-200/60 dark:hover:border-stone-800"
              }`}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-amber-500 dark:bg-amber-400" />
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
                      className="flex-1 min-w-0 text-xs font-medium bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded px-1.5 py-0.5 text-stone-800 dark:text-stone-100 outline-none focus:ring-1 focus:ring-amber-400"
                      autoFocus
                    />
                    <button
                      onClick={() => commitEdit(session.id)}
                      className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 shrink-0"
                      aria-label="Save"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 shrink-0"
                      aria-label="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <p
                    className={`text-xs font-medium truncate leading-snug ${
                      isActive
                        ? "text-stone-800 dark:text-stone-100"
                        : "text-stone-600 dark:text-stone-300"
                    }`}
                  >
                    {session.title}
                  </p>
                )}
                {!isEditing && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock size={9} className="text-stone-300 dark:text-stone-600 shrink-0" />
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">
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
                    className="p-1 rounded text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                    aria-label="Rename session"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => onDelete(session.id)}
                    className="p-1 rounded text-stone-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
      <div className="px-4 py-3 border-t border-stone-200/60 dark:border-stone-800">
        {tier === "free" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">
                Free plan · 5 messages/day
              </span>
              <span className="text-[9px] text-stone-400 dark:text-stone-600">resets midnight</span>
            </div>
            <div className="w-full bg-stone-200 dark:bg-stone-800 rounded-full h-0.5">
              <div className="bg-amber-400 dark:bg-amber-600 h-0.5 rounded-full w-0" />
            </div>
            <a
              href="/dashboard"
              className="block text-center text-[10px] font-medium text-amber-700 dark:text-amber-400 hover:underline"
            >
              Upgrade to Pro — unlimited messages ↗
            </a>
          </div>
        ) : (
          <p className="text-[10px] text-stone-400 dark:text-stone-600 text-center leading-relaxed">
            Each session has its own memory &amp; context
          </p>
        )}
      </div>
    </div>
  );
}
