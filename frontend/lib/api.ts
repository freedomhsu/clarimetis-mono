// In production the browser never calls the backend directly — all requests are
// forwarded through the Next.js server-side proxy at /api/proxy, which attaches
// a GCP identity token so the backend can stay fully private.
// In local development (no proxy server running), fall back to localhost.
const IS_SERVER = typeof window === "undefined";
const API_URL = IS_SERVER
  ? (process.env.BACKEND_URL ?? "http://localhost:8000")
  : "/api/proxy";

export interface Session {
  id: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  media_urls: string[] | null;
  crisis_flagged: boolean;
  created_at: string;
}

// Named sub-types — exported so pages and tests can import specific shapes
// without duplicating the inline Array<{...}> definitions.

export interface LogicLoop {
  topic: string;
  frequency: number;
  efficiency: number;
  fix_type: string;
}

export interface WellnessInsight {
  category: string;
  observation: string;
  trend: "improving" | "declining" | "stable" | null;
}

export interface Recommendation {
  type: "book" | "practice" | "course" | "strategy";
  title: string;
  description: string;
  why: string;
}

export interface RelationalObservation {
  person: string;
  quality: string;
  evidence: string;
  suggested_action: string;
  relationship_score: number | null;
}

export interface PriorityItem {
  rank: number;
  category: string;
  action: string;
  reasoning: string;
  urgency: "critical" | "high" | "medium" | "low";
}

export interface AnalyticsSummary {
  total_sessions: number;
  total_messages: number;
  data_reliability: "insufficient" | "low" | "moderate" | "high";
  confidence_score: number | null;
  anxiety_score: number | null;
  self_esteem_score: number | null;
  ego_score: number | null;
  emotion_control_score: number | null;
  self_awareness_score: number | null;
  motivation_score: number | null;
  stress_load: number | null;
  cognitive_noise: "low" | "moderate" | "high" | null;
  logic_loops: LogicLoop[];
  insights: WellnessInsight[];
  recommendations: Recommendation[];
  focus_areas: string[];
  relational_observations: RelationalObservation[];
  social_gratitude_index: number | null;
  priority_stack: PriorityItem[];
  generated_at: string;
}

export interface ScorePoint {
  date: string;
  confidence: number | null;
  anxiety: number | null;
  self_esteem: number | null;
  stress: number | null;
  social: number | null;
  ego: number | null;
  emotion_control: number | null;
  self_awareness: number | null;
  motivation: number | null;
}

export interface ScoreHistory {
  points: ScorePoint[];
}

export interface MediaFile {
  blob_path: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string | null; // null when GCS metadata is unavailable
  url: string;
}

export interface SubscriptionError {
  code: "subscription_required" | "daily_limit_reached" | "rate_limit_exceeded";
  message: string;
  limit?: number;
  upgrade_path: string;
}

/** Low-level fetch with auth + error parsing. Returns the raw `Response`. */
async function rawRequest(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Propagate structured subscription errors so the UI can handle them
    if ((res.status === 402 || res.status === 429) && body?.detail?.code) {
      const err = new Error(body.detail.message) as Error & { subscriptionError: SubscriptionError };
      err.subscriptionError = body.detail as SubscriptionError;
      throw err;
    }
    // Propagate plain-string FastAPI detail messages (e.g. 413 size limit,
    // 422 silent audio) directly so the UI can show a useful message.
    const detail = body?.detail;
    if (typeof detail === "string") throw new Error(detail);
    throw new Error(`${res.status}: ${body ? JSON.stringify(body) : res.statusText}`);
  }
  return res;
}

/** Convenience wrapper — fetches and returns parsed JSON. */
async function request<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  return (await rawRequest(path, token, options)).json() as Promise<T>;
}

export const api = {
  // ── Users ──────────────────────────────────────────────────────
  async syncUser(token: string, email: string, fullName?: string): Promise<void> {
    await request("/api/v1/users/sync", token, {
      method: "POST",
      body: JSON.stringify({ email, full_name: fullName ?? null }),
    });
  },

  async getMe(token: string): Promise<{ id: string; subscription_tier: string; email: string; full_name: string | null; storage_used_bytes: number; preferred_language: string }> {
    return request("/api/v1/users/me", token);
  },

  async getLanguage(token: string): Promise<{ preferred_language: string }> {
    return request("/api/v1/users/language", token);
  },

  async setLanguage(token: string, language: string): Promise<{ preferred_language: string }> {
    return request("/api/v1/users/language", token, {
      method: "PATCH",
      body: JSON.stringify({ language }),
    });
  },

  /** Starts a Stripe Checkout session — redirect the user to the returned URL. */
  async getSubscribeUrl(token: string, plan: "monthly" | "annual" = "monthly"): Promise<string> {
    const res = await request<{ url: string }>("/api/v1/users/subscribe", token, {
      method: "POST",
      body: JSON.stringify({ plan }),
    });
    return res.url;
  },

  /** Opens the Stripe Billing Portal — redirect the user to the returned URL. */
  async getBillingPortalUrl(token: string): Promise<string> {
    const res = await request<{ url: string }>("/api/v1/users/billing-portal", token, { method: "POST" });
    return res.url;
  },

  // ── Sessions ───────────────────────────────────────────────────
  async getSessions(token: string): Promise<Session[]> {
    return request("/api/v1/sessions", token);
  },

  async createSession(token: string, title?: string): Promise<Session> {
    return request("/api/v1/sessions", token, {
      method: "POST",
      body: JSON.stringify({ title: title ?? "New Session" }),
    });
  },

  async renameSession(token: string, sessionId: string, title: string): Promise<Session> {
    return request(`/api/v1/sessions/${sessionId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  },

  async deleteSession(token: string, sessionId: string): Promise<void> {
    await rawRequest(`/api/v1/sessions/${sessionId}`, token, { method: "DELETE" });
  },

  // ── Messages ───────────────────────────────────────────────────
  async getMessages(token: string, sessionId: string): Promise<Message[]> {
    return request(`/api/v1/sessions/${sessionId}/messages`, token);
  },

  async deleteMessage(token: string, sessionId: string, messageId: string): Promise<void> {
    await rawRequest(`/api/v1/sessions/${sessionId}/messages/${messageId}`, token, { method: "DELETE" });
  },

  /**
   * Returns the raw ReadableStream so the caller can stream chunks incrementally.
   */
  async sendMessage(
    token: string,
    sessionId: string,
    content: string,
    mediaUrls?: string[],
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const res = await rawRequest(`/api/v1/sessions/${sessionId}/messages`, token, {
      method: "POST",
      body: JSON.stringify({ content, media_urls: mediaUrls ?? null }),
      signal,
    });
    if (!res.body) throw new Error("No response body");
    return res.body;
  },

  // ── Media ──────────────────────────────────────────────────────
  async uploadMedia(
    token: string,
    file: File,
  ): Promise<{ url: string; blob_path: string; content_type: string }> {
    const form = new FormData();
    form.append("file", file);
    return (await rawRequest(`/api/v1/media/upload`, token, { method: "POST", body: form })).json();
  },

  // ── Voice ──────────────────────────────────────────────────────
  async transcribeAudio(
    token: string,
    audioBlob: Blob,
    signal?: AbortSignal,
  ): Promise<{ transcript: string }> {
    const ext = audioBlob.type.includes("mp4") ? "mp4" : "webm";
    const form = new FormData();
    form.append("file", audioBlob, `recording.${ext}`);
    return (await rawRequest(`/api/v1/voice/transcribe`, token, { method: "POST", body: form, signal })).json();
  },

  async voiceConversation(
    token: string,
    sessionId: string,
    audioBlob: Blob,
    signal?: AbortSignal,
  ): Promise<{ user_transcript: string; assistant_text: string; audio_data: string; crisis_flagged: boolean }> {
    const ext = audioBlob.type.includes("mp4") ? "mp4" : "webm";
    const form = new FormData();
    form.append("file", audioBlob, `recording.${ext}`);
    return (await rawRequest(`/api/v1/voice/conversation/${sessionId}`, token, { method: "POST", body: form, signal })).json();
  },

  // ── Media library ──────────────────────────────────────────────
  async listMedia(token: string): Promise<MediaFile[]> {
    return request("/api/v1/media", token);
  },

  async deleteMedia(token: string, blobPath: string): Promise<void> {
    await rawRequest(`/api/v1/media/${blobPath}`, token, { method: "DELETE" });
  },

  // ── Analytics ──────────────────────────────────────────────────
  async getAnalytics(token: string, force = false): Promise<AnalyticsSummary> {
    const url = force ? "/api/v1/analytics/summary?force=true" : "/api/v1/analytics/summary";
    return request(url, token);
  },
  async getScoreHistory(token: string): Promise<ScoreHistory> {
    return request("/api/v1/analytics/history", token);
  },
};
