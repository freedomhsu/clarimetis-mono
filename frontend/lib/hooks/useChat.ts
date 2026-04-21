"use client";

import { useCallback, useRef, useState } from "react";
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

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
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

  const sendMessage = useCallback(
    async (content: string, mediaUrls?: string[]) => {
      const token = await getToken();
      if (!token) return;

      // Optimistically add the user message
      const userMsg: Message = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        role: "user",
        content,
        media_urls: mediaUrls ?? null,
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
        const stream = await api.sendMessage(token, sessionId, content, mediaUrls, abort.signal);
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
          for (const status of result.statusUpdates) setThinkingStatus(status);
          if (result.contentChanged) setStreamingContent(accumulated);
        }

        // Add a local message immediately for snappy UI, then reload from the
        // server in the background to pick up the accurate `crisis_flagged` value.
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: "assistant",
          content: accumulated,
          media_urls: null,
          crisis_flagged: false,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");
        setThinkingStatus("");
        accumulatedRef.current = "";
        // Fire-and-forget: sync server state (correct id, crisis_flagged, etc.)
        loadMessages();
      } catch (err) {
        // User stopped generation — keep whatever was already streamed
        if (err instanceof Error && err.name === "AbortError") {
          const partial = accumulatedRef.current;
          accumulatedRef.current = "";
          if (partial) {
            const assistantMsg: Message = {
              id: crypto.randomUUID(),
              session_id: sessionId,
              role: "assistant",
              content: partial,
              media_urls: null,
              crisis_flagged: false,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
          }
          setStreamingContent("");
          setThinkingStatus("");
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
          setSendError("Something went wrong. Please try again.");
        }
      } finally {
        setIsLoading(false);
      }
    },
    [getToken, sessionId, loadMessages]
  );

  return { messages, isLoading, streamingContent, thinkingStatus, subscriptionError, setSubscriptionError, sendError, setSendError, loadMessages, sendMessage, stopGeneration };
}
