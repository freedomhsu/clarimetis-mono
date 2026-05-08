"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { MessageCircle } from "lucide-react";
import { SessionList } from "./SessionList";
import { ChatWindow } from "./ChatWindow";
import { api, type Session } from "@/lib/api";
import { useDashboard } from "@/components/providers/DashboardContext";

// The set of session IDs that have been opened at least once in this mount.
// We keep their ChatWindow instances alive (hidden) so that in-flight streams
// and loading state are preserved when the user switches to another session
// and then switches back.
type MountedSessions = Set<string>;

interface Props {
  initialSessionId?: string;
}

export function ChatContainer({ initialSessionId }: Props) {
  const { getToken, isLoaded } = useAuth();
  const router = useRouter();
  const { tier } = useDashboard();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessionId ?? null
  );
  const [actionError, setActionError] = useState<string | null>(null);
  // Tracks every session ID whose ChatWindow has been mounted at least once.
  // Kept as state so that adding a new session triggers a render.
  const [mountedSessions, setMountedSessions] = useState<MountedSessions>(
    () => new Set(initialSessionId ? [initialSessionId] : [])
  );
  // Tracks which sessions currently have an in-flight AI response so the
  // sidebar can show a spinner even when the session window is hidden.
  const [loadingSessions, setLoadingSessions] = useState<Set<string>>(
    () => new Set()
  );
  const [isCreating, setIsCreating] = useState(false);

  // Keep a ref so loadSessions can read the current activeSessionId without
  // being re-created every time it changes.
  const activeSessionIdRef = useRef(activeSessionId);
  // Tracks a pending retry timeout so it can be cancelled on unmount.
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Cancel any pending retry on unmount.
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current !== null) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  const loadSessions = useCallback(async (retryOnNotFound = true) => {
    const token = await getToken();
    if (!token) return;
    try {
      const data = await api.getSessions(token);
      setSessions(data);
      const currentId = activeSessionIdRef.current;
      if (currentId) {
        const exists = data.some((s) => s.id === currentId);
        if (!exists) {
          setActiveSessionId(null);
          router.replace("/chat");
          return;
        }
      } else if (data.length > 0) {
        setActiveSessionId(data[0].id);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("404")) {
        if (retryOnNotFound) {
          retryTimeoutRef.current = setTimeout(() => loadSessions(false), 800);
        }
        return;
      }
      throw err;
    }
  }, [getToken, router]); // activeSessionId removed — accessed via ref

  useEffect(() => {
    if (!isLoaded) return;
    loadSessions();
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    setActionError(null);
    const token = await getToken();
    if (!token) { setIsCreating(false); return; }
    try {
      const session = await api.createSession(token);
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMountedSessions((prev) => {
        const next = new Set(prev);
        next.add(session.id);
        return next;
      });
      router.push(`/chat/${session.id}`);
    } catch {
      setActionError("Failed to create session. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelect = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMountedSessions((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
    router.push(`/chat/${sessionId}`);
  };

  const handleDelete = async (sessionId: string) => {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    setActionError(null);
    const token = await getToken();
    if (!token) return;
    try {
      await api.deleteSession(token, sessionId);
    } catch {
      setActionError("Failed to delete session. Please try again.");
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setMountedSessions((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    if (activeSessionId === sessionId) {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      const next = remaining[0]?.id ?? null;
      setActiveSessionId(next);
      router.push(next ? `/chat/${next}` : "/chat");
    }
  };

  const handleRename = async (sessionId: string, title: string) => {
    const token = await getToken();
    if (!token) return;
    try {
      const updated = await api.renameSession(token, sessionId, title);
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: updated.title } : s)));
    } catch {
      setActionError("Failed to rename session. Please try again.");
    }
  };

  return (
    <div className="flex h-full">
      <SessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        loadingSessions={loadingSessions}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={handleRename}
        tier={tier}
        isCreating={isCreating}
      />

      <div className="flex-1 h-full overflow-hidden">
        {actionError && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {actionError}
          </div>
        )}
        {/* Render a ChatWindow for every session that has been opened.
            Hidden windows stay mounted so their useChat hook (and any
            in-flight streaming state) survives session switching. */}
        {Array.from(mountedSessions).map((sid) => (
          <div key={sid} className={sid === activeSessionId ? "h-full" : "hidden"}>
            <ChatWindow
              sessionId={sid}
              sessionTitle={sessions.find((s) => s.id === sid)?.title}
              tier={tier}
              onLoadingChange={(loading) =>
                setLoadingSessions((prev) => {
                  if (loading === prev.has(sid)) return prev;
                  const next = new Set(prev);
                  loading ? next.add(sid) : next.delete(sid);
                  return next;
                })
              }
            />
          </div>
        ))}
        {!activeSessionId && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 space-y-4 bg-slate-50 dark:bg-[#080810]">
            <div className="relative w-14 h-14 mx-auto">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 blur-xl" />
              <div className="relative w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-[#1a1a2e] border border-indigo-200/50 dark:border-indigo-700/40 flex items-center justify-center">
                <MessageCircle size={22} className="text-indigo-600 dark:text-indigo-400" />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No session selected</p>
              <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">Pick a session from the list or start a new one.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
