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

export interface AnalyticsSummary {
  total_sessions: number;
  total_messages: number;
  data_reliability: "insufficient" | "low" | "moderate" | "high";
  confidence_score: number | null;
  anxiety_score: number | null;
  self_esteem_score: number | null;
  stress_load: number | null;
  cognitive_noise: "low" | "moderate" | "high" | null;
  logic_loops: Array<{
    topic: string;
    frequency: number;
    efficiency: number;
    fix_type: string;
  }>;
  insights: Array<{
    category: string;
    observation: string;
    trend: string | null;
  }>;
  recommendations: Array<{
    type: string;
    title: string;
    description: string;
    why: string;
  }>;
  focus_areas: string[];
  relational_observations: Array<{
    person: string;
    quality: string;
    evidence: string;
    suggested_action: string;
    relationship_score: number | null;
  }>;
  social_gratitude_index: number | null;
  priority_stack: Array<{
    rank: number;
    category: string;
    action: string;
    reasoning: string;
    urgency: "critical" | "high" | "medium" | "low";
  }>;
  generated_at: string;
}

export interface ScorePoint {
  date: string;
  confidence: number | null;
  anxiety: number | null;
  self_esteem: number | null;
  stress: number | null;
  social: number | null;
}

export interface ScoreHistory {
  points: ScorePoint[];
}

export interface SubscriptionError {
  code: "subscription_required" | "daily_limit_reached";
  message: string;
  limit?: number;
  upgrade_path: string;
}

async function request<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
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
    const text = body ? JSON.stringify(body) : res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ── Users ──────────────────────────────────────────────────────
  async syncUser(token: string, email: string, fullName?: string): Promise<void> {
    await request("/api/v1/users/sync", token, {
      method: "POST",
      body: JSON.stringify({ email, full_name: fullName ?? null }),
    });
  },

  async getMe(token: string): Promise<{ id: string; subscription_tier: string; email: string; full_name: string | null }> {
    return request("/api/v1/users/me", token);
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

  async deleteSession(token: string, sessionId: string): Promise<void> {
    const baseUrl = typeof window === "undefined" ? (process.env.BACKEND_URL ?? "http://localhost:8000") : "/api/proxy";
    const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if ((res.status === 402 || res.status === 429) && body?.detail?.code) {
        const err = new Error(body.detail.message) as Error & { subscriptionError: SubscriptionError };
        err.subscriptionError = body.detail as SubscriptionError;
        throw err;
      }
      throw new Error(`${res.status}: Failed to delete session`);
    }
  },

  // ── Messages ───────────────────────────────────────────────────
  async getMessages(token: string, sessionId: string): Promise<Message[]> {
    return request(`/api/v1/sessions/${sessionId}/messages`, token);
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
    const baseUrl = typeof window === "undefined" ? (process.env.BACKEND_URL ?? "http://localhost:8000") : "/api/proxy";
    const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, media_urls: mediaUrls ?? null }),
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if ((res.status === 402 || res.status === 429) && body?.detail?.code) {
        const err = new Error(body.detail.message) as Error & { subscriptionError: SubscriptionError };
        err.subscriptionError = body.detail as SubscriptionError;
        throw err;
      }
      throw new Error(`${res.status}: Failed to send message`);
    }
    if (!res.body) throw new Error("No response body");
    return res.body;
  },

  // ── Media ──────────────────────────────────────────────────────
  async uploadMedia(
    token: string,
    file: File
  ): Promise<{ url: string; content_type: string }> {
    const form = new FormData();
    form.append("file", file);
    const baseUrl = typeof window === "undefined" ? (process.env.BACKEND_URL ?? "http://localhost:8000") : "/api/proxy";
    const res = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if ((res.status === 402 || res.status === 429) && body?.detail?.code) {
        const err = new Error(body.detail.message) as Error & { subscriptionError: SubscriptionError };
        err.subscriptionError = body.detail as SubscriptionError;
        throw err;
      }
      throw new Error(`${res.status}: Failed to upload media`);
    }
    return res.json();
  },

  // ── Voice ──────────────────────────────────────────────────────
  async transcribeAudio(
    token: string,
    audioBlob: Blob
  ): Promise<{ transcript: string }> {
    const form = new FormData();
    form.append("file", audioBlob, "recording.webm");
    const baseUrl = typeof window === "undefined" ? (process.env.BACKEND_URL ?? "http://localhost:8000") : "/api/proxy";
    const res = await fetch(`${baseUrl}/api/v1/voice/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if ((res.status === 402 || res.status === 429) && body?.detail?.code) {
        const err = new Error(body.detail.message) as Error & { subscriptionError: SubscriptionError };
        err.subscriptionError = body.detail as SubscriptionError;
        throw err;
      }
      throw new Error(`${res.status}: Failed to transcribe audio`);
    }
    return res.json();
  },

  // ── Analytics ──────────────────────────────────────────────────
  async getAnalytics(token: string): Promise<AnalyticsSummary> {
    return request("/api/v1/analytics/summary", token);
  },
  async getScoreHistory(token: string): Promise<ScoreHistory> {
    return request("/api/v1/analytics/history", token);
  },
};
