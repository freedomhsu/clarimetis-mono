"use client";

import { useParams } from "next/navigation";
import { ChatContainer } from "@/components/chat/ChatContainer";

export default function ChatSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <ChatContainer initialSessionId={sessionId} />;
}
