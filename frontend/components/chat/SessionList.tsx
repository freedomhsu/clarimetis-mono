"use client";

import { useRef, useState } from "react";
import {
  MessageSquare,
  Plus,
  Trash2,
  Search,
  Clock,
  Pencil,
  Check,
  X,
  Brain,
} from "lucide-react";
import type { Session } from "@/lib/api";

interface Props {
  sessions: Session[];
  activeSessionId: string | null;
  /** Session IDs that currently have an in-flight AI response. */
  loadingSessions?: Set<string>;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  tier?: "free" | "pro";
  isCreating?: boolean;
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return date.toLocaleDateString([], opts);
}

export function SessionList({
  sessions,
  activeSessionId,
  loadingSessions,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  tier = "free",
  isCreating = false,
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
    <div className="w-64 shrink-0 border-r border-slate-200 dark:border-white/[0.05] bg-white dark:bg-[#0c0c18] flex flex-col h-full">

      {/* ── Header ── */}
      <div className="relative overflow-hidden px-4 pt-5 pb-4 space-y-3">
        {/* Ambient depth layers */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 w-28 h-full bg-gradient-to-r from-indigo-600/[0.07] to-transparent" />
          <div className="absolute -top-2 left-8 w-16 h-8 rounded-full bg-indigo-500/10 blur-2xl" />
        </div>
        {/* Gradient bottom border */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 dark:via-indigo-500/30 to-transparent" />

        {/* Brand row */}
        <div className="relative flex items-center gap-2.5">
          <div className="relative shrink-0">
            <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-indigo-500/35 to-violet-600/35 blur-lg" />
            <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/30 ring-1 ring-white/[0.12]">
              <Brain size={14} className="text-white" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-100 leading-tight">Sessions</p>
            <p className="text-[10px] font-medium bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent">
              {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* New Session button */}
        <button
          onClick={onCreate}
          disabled={isCreating}
          className="relative w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold active:scale-[0.98] transition-all text-white bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 shadow-md shadow-indigo-900/20 ring-1 ring-white/[0.10] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Plus size={13} />
          New Session
        </button>

        {sessions.length > 3 && (
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-[#13131f] border border-slate-200 dark:border-indigo-900/40 rounded-lg text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500/25 dark:focus:ring-indigo-500/20 transition"
            />
          </div>
        )}
      </div>

      {/* ── Session list ── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-3 mt-10 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/40 flex items-center justify-center">
              <MessageSquare size={18} className="text-indigo-300 dark:text-indigo-700" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">No sessions yet</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-0.5 leading-relaxed">
                Start a new session to begin.
              </p>
            </div>
          </div>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-600 text-center mt-6 px-3">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}

        {filtered.map((session) => {
          const isActive = session.id === activeSessionId;
          const isEditing = editingId === session.id;
          const isGenerating = !!loadingSessions?.has(session.id) && !isActive;

          return (
            <div
              key={session.id}
              onClick={() => !isEditing && onSelect(session.id)}
              className={`group relative flex items-start gap-2 rounded-xl px-2.5 py-2.5 cursor-pointer transition-all ${
                isActive
                  ? "bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/70 dark:border-indigo-800/50 shadow-sm"
                  : "border border-transparent hover:bg-slate-50 dark:hover:bg-[#13131f] hover:border-slate-200 dark:hover:border-indigo-900/40"
              }`}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
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
                      className="flex-1 min-w-0 text-xs font-medium bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-300 dark:border-indigo-700/60 rounded-lg px-1.5 py-0.5 text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-indigo-500/40"
                      autoFocus
                    />
                    <button
                      onClick={() => commitEdit(session.id)}
                      className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 shrink-0"
                      aria-label="Save"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0"
                      aria-label="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <p
                    className={`text-xs font-medium truncate leading-snug ${
                      isActive
                        ? "text-indigo-900 dark:text-indigo-200"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {session.title}
                  </p>
                )}
                {!isEditing && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock size={9} className="text-slate-300 dark:text-slate-700 shrink-0" />
                    <span className="text-[10px] text-slate-400 dark:text-slate-600">
                      {relativeTime(session.updated_at)}
                    </span>
                    {isGenerating && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500 dark:text-indigo-400">
                        <span className="flex gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                          <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
                          <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce [animation-delay:300ms]" />
                        </span>
                        AI thinking
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {!isEditing && (
                <div
                  className={`flex items-center gap-0.5 shrink-0 mt-0.5 transition-opacity ${
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => startEdit(session)}
                    className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors"
                    aria-label="Rename session"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => onDelete(session.id)}
                    className="p-1 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
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


    </div>
  );
}

