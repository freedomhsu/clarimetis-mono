"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, type Message, type SubscriptionError } from "@/lib/api";
import { parseStreamChunk } from "@/lib/parseStream";

export function useChat(sessionId: string) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [thinkingStatus, setThinkingStatus] = useState("");
  const [subscriptionError, setSubscriptionError] = useState<SubscriptionError | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Ref mirrors the accumulated streamed text so the AbortError handler can
  // read the current value without a stale closure over `streamingContent`.
  const accumulatedRef = useRef("");
  // Track which sessionId the current messages belong to so we can reset state
  // when the session changes without unmounting the component (avoids flicker).
  const sessionIdRef = useRef(sessionId);
  // Tracks a pending post-stream refresh so it can be cancelled on unmount.
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Abort any in-flight stream and cancel any pending refresh when the
  // component unmounts (e.g. the user navigates away from the chat route).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (refreshTimeoutRef.current !== null) clearTimeout(refreshTimeoutRef.current);
    };
  }, []);

  const loadMessages = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const msgs = await api.getMessages(token, sessionId);
      setMessages(msgs);
    } catch (err) {
      // Session no longer exists (e.g. after a DB reset) — swallow the 404
      if (err instanceof Error && err.message.startsWith("404")) return;
      throw err;
    }
  }, [getToken, sessionId]);

  // Reset all state when sessionId changes so stale messages/stream never
  // show for a split second before the new session loads (eliminates flicker).
  useEffect(() => {
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;
    setMessages([]);
    setStreamingContent("");
    setThinkingStatus("");
    setIsLoading(false);
    setSubscriptionError(null);
    setSendError(null);
    accumulatedRef.current = "";
  }, [sessionId]);

  const sendMessage = useCallback(
    async (content: string, mediaUrls?: string[], previewUrls?: string[]) => {
      const token = await getToken();
      if (!token) return;

      // Capture sessionId at call time — the user may switch sessions while the
      // stream is in flight. We keep the stream running (backend saves it via
      // BackgroundTask) but only update UI state when still on the same session.
      const capturedSessionId = sessionId;

      // Optimistically add the user message.
      // Use previewUrls (signed HTTPS) for display; mediaUrls (blob paths) are
      // what the backend receives. After the stream completes we schedule a
      // loadMessages() refresh (see below) to replace this entry with the
      // server copy carrying re-signed URLs and the accurate crisis_flagged flag.
      const userMsg: Message = {
        id: crypto.randomUUID(),
        session_id: capturedSessionId,
        role: "user",
        content,
        media_urls: previewUrls ?? mediaUrls ?? null,
        crisis_flagged: false,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setStreamingContent("");
      setThinkingStatus("");
      setSubscriptionError(null);
      setSendError(null);

      try {
        const abort = new AbortController();
        abortRef.current = abort;
        const stream = await api.sendMessage(token, capturedSessionId, content, mediaUrls, abort.signal);
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";
        accumulatedRef.current = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const result = parseStreamChunk(chunk, buffer, accumulated);
          accumulated = result.accumulated;
          buffer = result.buffer;
          accumulatedRef.current = accumulated;
          // Only update UI when still on the same session; keep reading so the
          // backend finishes generating and saves the message via BackgroundTask.
          if (sessionIdRef.current === capturedSessionId) {
            for (const status of result.statusUpdates) setThinkingStatus(status);
            if (result.contentChanged) setStreamingContent(accumulated);
          }
        }

        // Stream finished — if we're still on the same session, append the
        // completed assistant message to the UI immediately, then schedule a
        // refresh so the server copy (with real IDs, re-signed media URLs, and
        // accurate crisis_flagged) replaces the optimistic entries.
        // The backend saves the assistant message via BackgroundTask, so we
        // wait briefly before fetching to let that commit complete.
        if (sessionIdRef.current === capturedSessionId) {
          const isCrisis = accumulated.includes("988lifeline.org");
          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            session_id: capturedSessionId,
            role: "assistant",
            content: accumulated,
            media_urls: null,
            crisis_flagged: isCrisis,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setStreamingContent("");
          setThinkingStatus("");
          accumulatedRef.current = "";
          // Retry-safe refresh: only apply the server copy once it includes the
          // assistant message (the BackgroundTask may take >600ms to commit).
          // Retries up to 4 times with increasing delays before giving up.
          const doRefresh = async (attempt = 0) => {
            if (sessionIdRef.current !== capturedSessionId) return;
            try {
              const token = await getToken();
              if (!token || sessionIdRef.current !== capturedSessionId) return;
              const serverMsgs = await api.getMessages(token, capturedSessionId);
              if (sessionIdRef.current !== capturedSessionId) return;
              const lastMsg = serverMsgs[serverMsgs.length - 1];
              if (lastMsg?.role === "assistant") {
                setMessages(serverMsgs);
              } else if (attempt < 4) {
                refreshTimeoutRef.current = setTimeout(
                  () => doRefresh(attempt + 1),
                  800 * (attempt + 1),
                );
              }
            } catch {
              // Refresh errors are non-fatal — optimistic message stays visible
            }
          };
          refreshTimeoutRef.current = setTimeout(() => doRefresh(), 800);
        }
        // If the session changed, the backend saves the message via BackgroundTask.
        // When the user returns to this session, loadMessages() will fetch it.
      } catch (err) {
        // User stopped generation — keep whatever was already streamed
        if (err instanceof Error && err.name === "AbortError") {
          const partial = accumulatedRef.current;
          accumulatedRef.current = "";
          if (partial && sessionIdRef.current === capturedSessionId) {
            const assistantMsg: Message = {
              id: crypto.randomUUID(),
              session_id: capturedSessionId,
              role: "assistant",
              content: partial,
              media_urls: null,
              crisis_flagged: false,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
          }
          if (sessionIdRef.current === capturedSessionId) {
            setStreamingContent("");
            setThinkingStatus("");
          }
          return;
        }
        // Subscription / quota errors — surface to UI instead of swallowing
        const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
        if (subErr) {
          setSubscriptionError(subErr);
          // Remove the optimistic message (it was never saved on the server)
          setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
        } else {
          console.error("Chat error:", err);
          // Roll back the optimistic message and show an error banner
          setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
          if (sessionIdRef.current === capturedSessionId) {
            setSendError("Something went wrong. Please try again.");
          }
        }
      } finally {
        if (sessionIdRef.current === capturedSessionId) {
          setIsLoading(false);
        }
      }
    },
    [getToken, sessionId, loadMessages]
  );

  return { messages, isLoading, streamingContent, thinkingStatus, subscriptionError, setSubscriptionError, sendError, setSendError, loadMessages, sendMessage, stopGeneration };
}
