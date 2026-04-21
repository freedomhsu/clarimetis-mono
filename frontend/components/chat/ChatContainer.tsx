"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { MessageCircle } from "lucide-react";
import { SessionList } from "./SessionList";
import { ChatWindow } from "./ChatWindow";
import { api, type Session } from "@/lib/api";
import { useDashboard } from "@/components/providers/DashboardContext";

interface Props {
  initialSessionId?: string;
}

export function ChatContainer({ initialSessionId }: Props) {
  const { getToken } = useAuth();
  const router = useRouter();
  const { tier } = useDashboard();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessionId ?? null
  );
  const [actionError, setActionError] = useState<string | null>(null);

  // Keep a ref so loadSessions can read the current activeSessionId without
  // being re-created every time it changes.
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

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
          setTimeout(() => loadSessions(false), 800);
        }
        return;
      }
      throw err;
    }
  }, [getToken, router]); // activeSessionId removed — accessed via ref

  useEffect(() => {
    loadSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    setActionError(null);
    const token = await getToken();
    if (!token) return;
    try {
      const session = await api.createSession(token);
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      router.push(`/chat/${session.id}`);
    } catch {
      setActionError("Failed to create session. Please try again.");
    }
  };

  const handleSelect = (sessionId: string) => {
    setActiveSessionId(sessionId);
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
    if (activeSessionId === sessionId) {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      const next = remaining[0]?.id ?? null;
      setActiveSessionId(next);
      router.push(next ? `/chat/${next}` : "/chat");
    }
  };

  return (
    <div className="flex h-full">
      <SessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        tier={tier}
      />

      <div className="flex-1 h-full overflow-hidden">
        {actionError && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {actionError}
          </div>
        )}
        {activeSessionId ? (
          <ChatWindow
            key={activeSessionId}
            sessionId={activeSessionId}
            sessionTitle={sessions.find((s) => s.id === activeSessionId)?.title}
            tier={tier}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center shadow-lg shadow-brand-200 dark:shadow-brand-900/30">
              <MessageCircle size={28} className="text-white" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-700 dark:text-gray-200">No session selected</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Pick a session from the list or start a new one.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
