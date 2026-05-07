/**
 * Unit tests for the API methods not covered by api.test.ts or analytics-api.test.ts.
 *
 * Covers:
 *   api.syncUser       — POST /users/sync, no return value
 *   api.getMe          — GET /users/me, returns user object
 *   api.getLanguage    — GET /users/language
 *   api.setLanguage    — PATCH /users/language
 *   api.getSubscribeUrl — POST /users/subscribe, returns redirect URL
 *   api.getBillingPortalUrl — POST /users/billing-portal, returns redirect URL
 *   api.transcribeAudio — POST /voice/transcribe (FormData)
 *   api.voiceConversation — POST /voice/conversation/:id (FormData)
 *   api.listMedia      — GET /media
 *   api.deleteMedia    — DELETE /media/:path
 *   api.getAnalytics(force=true) — appends ?force=true to URL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function subErrorResponse(status: 402 | 429, code: "subscription_required" | "daily_limit_reached") {
  return jsonResponse(
    { detail: { code, message: "Upgrade required", upgrade_path: "/users/subscribe" } },
    status,
  );
}

function getLastCall() {
  const calls = mockFetch.mock.calls;
  const [url, init] = calls[calls.length - 1] as [string, RequestInit];
  return { url, init, headers: (init?.headers ?? {}) as Record<string, string> };
}

// ── api.syncUser ───────────────────────────────────────────────────────────

describe("api.syncUser()", () => {
  it("sends a POST to /api/v1/users/sync with email and full_name", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await api.syncUser("tok", "alice@example.com", "Alice Smith");
    const { url, init } = getLastCall();
    expect(url).toContain("/api/v1/users/sync");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.email).toBe("alice@example.com");
    expect(body.full_name).toBe("Alice Smith");
  });

  it("sends full_name=null when fullName is omitted", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await api.syncUser("tok", "bob@example.com");
    const { init } = getLastCall();
    const body = JSON.parse(init.body as string);
    expect(body.full_name).toBeNull();
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await api.syncUser("my-token", "a@b.com");
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });
});

// ── api.getMe ──────────────────────────────────────────────────────────────

describe("api.getMe()", () => {
  const fakeUser = {
    id: "u1",
    subscription_tier: "pro",
    email: "alice@example.com",
    full_name: "Alice",
    storage_used_bytes: 1024,
    preferred_language: "en",
  };

  it("calls GET /api/v1/users/me", async () => {
    mockFetch.mockResolvedValue(jsonResponse(fakeUser));
    await api.getMe("tok");
    const { url, init } = getLastCall();
    expect(url).toContain("/api/v1/users/me");
    expect(init.method).toBeUndefined(); // default GET
  });

  it("returns the parsed user object on 200", async () => {
    mockFetch.mockResolvedValue(jsonResponse(fakeUser));
    const result = await api.getMe("tok");
    expect(result).toEqual(fakeUser);
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse(fakeUser));
    await api.getMe("secret-tok");
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer secret-tok");
  });

  it("throws on 401", async () => {
    // Passing a non-string body so request() throws `"401: {...}"` (status-prefixed).
    mockFetch.mockResolvedValue(jsonResponse({ message: "Unauthorized" }, 401));
    await expect(api.getMe("tok")).rejects.toThrow("401");
  });
});

// ── api.getLanguage ────────────────────────────────────────────────────────

describe("api.getLanguage()", () => {
  it("calls GET /api/v1/users/language and returns the preferred_language", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ preferred_language: "es" }));
    const result = await api.getLanguage("tok");
    const { url } = getLastCall();
    expect(url).toContain("/api/v1/users/language");
    expect(result.preferred_language).toBe("es");
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ preferred_language: "en" }));
    await api.getLanguage("my-token");
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });
});

// ── api.setLanguage ────────────────────────────────────────────────────────

describe("api.setLanguage()", () => {
  it("sends a PATCH to /api/v1/users/language with the language in the body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ preferred_language: "fr" }));
    const result = await api.setLanguage("tok", "fr");
    const { url, init } = getLastCall();
    expect(url).toContain("/api/v1/users/language");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ language: "fr" });
    expect(result.preferred_language).toBe("fr");
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ preferred_language: "ja" }));
    await api.setLanguage("tok-abc", "ja");
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
  });
});

// ── api.getSubscribeUrl ────────────────────────────────────────────────────

describe("api.getSubscribeUrl()", () => {
  it("sends POST to /api/v1/users/subscribe and returns the checkout URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/pay/abc" }));
    const url = await api.getSubscribeUrl("tok", "monthly");
    const { url: reqUrl, init } = getLastCall();
    expect(reqUrl).toContain("/api/v1/users/subscribe");
    expect(init.method).toBe("POST");
    expect(url).toBe("https://checkout.stripe.com/pay/abc");
  });

  it("includes the plan in the request body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/pay/xyz" }));
    await api.getSubscribeUrl("tok", "annual");
    const { init } = getLastCall();
    expect(JSON.parse(init.body as string)).toEqual({ plan: "annual" });
  });

  it("defaults to monthly when plan is omitted", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/pay/def" }));
    await api.getSubscribeUrl("tok");
    const { init } = getLastCall();
    expect(JSON.parse(init.body as string).plan).toBe("monthly");
  });

  it("throws with .subscriptionError on 402", async () => {
    mockFetch.mockResolvedValue(subErrorResponse(402, "subscription_required"));
    const err = await api.getSubscribeUrl("tok").catch((e) => e);
    expect(err.subscriptionError).toBeDefined();
  });
});

// ── api.getBillingPortalUrl ────────────────────────────────────────────────

describe("api.getBillingPortalUrl()", () => {
  it("sends POST to /api/v1/users/billing-portal and returns the portal URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ url: "https://billing.stripe.com/session/abc" }));
    const url = await api.getBillingPortalUrl("tok");
    const { url: reqUrl, init } = getLastCall();
    expect(reqUrl).toContain("/api/v1/users/billing-portal");
    expect(init.method).toBe("POST");
    expect(url).toBe("https://billing.stripe.com/session/abc");
  });

  it("throws on non-200 responses", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "Not found" }, 404));
    await expect(api.getBillingPortalUrl("tok")).rejects.toThrow("404");
  });
});

// ── api.transcribeAudio ────────────────────────────────────────────────────

describe("api.transcribeAudio()", () => {
  function makeBlob(type: string) {
    return new Blob(["audio"], { type });
  }

  it("calls POST /api/v1/voice/transcribe and returns the transcript", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "Hello world" }), { status: 200 }),
    );
    const result = await api.transcribeAudio("tok", makeBlob("audio/webm"));
    const { url, init } = getLastCall();
    expect(url).toContain("/api/v1/voice/transcribe");
    expect(init.method).toBe("POST");
    expect(result.transcript).toBe("Hello world");
  });

  it("uses .webm extension for non-mp4 blobs", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "" }), { status: 200 }),
    );
    await api.transcribeAudio("tok", makeBlob("audio/webm"));
    const { init } = getLastCall();
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("recording.webm");
  });

  it("uses .mp4 extension for mp4 blobs", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "" }), { status: 200 }),
    );
    await api.transcribeAudio("tok", makeBlob("audio/mp4"));
    const { init } = getLastCall();
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("recording.mp4");
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "" }), { status: 200 }),
    );
    await api.transcribeAudio("my-token", makeBlob("audio/webm"));
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });
});

// ── api.voiceConversation ──────────────────────────────────────────────────

describe("api.voiceConversation()", () => {
  const fakeResult = {
    user_transcript: "Hello",
    assistant_text: "Hi there!",
    audio_data: "data:audio/mpeg;base64,AAAA",
    crisis_flagged: false,
  };

  function makeBlob(type: string) {
    return new Blob(["audio"], { type });
  }

  it("calls POST /api/v1/voice/conversation/:sessionId", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(fakeResult), { status: 200 }),
    );
    await api.voiceConversation("tok", "sess-123", makeBlob("audio/webm"));
    const { url, init } = getLastCall();
    expect(url).toContain("/api/v1/voice/conversation/sess-123");
    expect(init.method).toBe("POST");
  });

  it("returns the full conversation result", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(fakeResult), { status: 200 }),
    );
    const result = await api.voiceConversation("tok", "sess-1", makeBlob("audio/webm"));
    expect(result).toEqual(fakeResult);
  });

  it("uses .mp4 extension for mp4 blobs", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(fakeResult), { status: 200 }),
    );
    await api.voiceConversation("tok", "sess-1", makeBlob("audio/mp4"));
    const { init } = getLastCall();
    const file = (init.body as FormData).get("file") as File;
    expect(file.name).toBe("recording.mp4");
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(fakeResult), { status: 200 }),
    );
    await api.voiceConversation("my-token", "sess-1", makeBlob("audio/webm"));
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });

  it("sets crisis_flagged=true when the response indicates a crisis", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ...fakeResult, crisis_flagged: true }), { status: 200 }),
    );
    const result = await api.voiceConversation("tok", "sess-1", makeBlob("audio/webm"));
    expect(result.crisis_flagged).toBe(true);
  });
});

// ── api.listMedia ──────────────────────────────────────────────────────────

describe("api.listMedia()", () => {
  const fakeFiles = [
    { path: "uploads/u1/a.jpg", url: "https://cdn.example.com/a.jpg", size_bytes: 1024, content_type: "image/jpeg", uploaded_at: "2024-01-01T00:00:00Z" },
    { path: "uploads/u1/b.pdf", url: "https://cdn.example.com/b.pdf", size_bytes: 2048, content_type: "application/pdf", uploaded_at: "2024-01-02T00:00:00Z" },
  ];

  it("calls GET /api/v1/media and returns an array of files", async () => {
    mockFetch.mockResolvedValue(jsonResponse(fakeFiles));
    const result = await api.listMedia("tok");
    const { url } = getLastCall();
    expect(url).toContain("/api/v1/media");
    expect(result).toEqual(fakeFiles);
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse(fakeFiles));
    await api.listMedia("my-token");
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });

  it("returns an empty array when there are no files", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    const result = await api.listMedia("tok");
    expect(result).toEqual([]);
  });

  it("throws with .subscriptionError on 402", async () => {
    mockFetch.mockResolvedValue(subErrorResponse(402, "subscription_required"));
    const err = await api.listMedia("tok").catch((e) => e);
    expect(err.subscriptionError).toBeDefined();
  });
});

// ── api.deleteMedia ────────────────────────────────────────────────────────

describe("api.deleteMedia()", () => {
  it("calls DELETE /api/v1/media/:blobPath", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteMedia("tok", "uploads/u1/photo.jpg");
    const { url, init } = getLastCall();
    expect(url).toContain("/api/v1/media/uploads/u1/photo.jpg");
    expect(init.method).toBe("DELETE");
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteMedia("my-token", "path/file.jpg");
    const { headers } = getLastCall();
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });

  it("resolves without error on 204", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteMedia("tok", "path/x.jpg")).resolves.toBeUndefined();
  });

  it("throws on 404", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "Not found" }, 404));
    await expect(api.deleteMedia("tok", "path/x.jpg")).rejects.toThrow("404");
  });
});

// ── api.getAnalytics() — force=true URL branch ────────────────────────────

describe("api.getAnalytics() — force parameter", () => {
  const FAKE_SUMMARY = { total_sessions: 1, total_messages: 5, data_reliability: "low" };

  it("omits ?force=true from the URL when force=false (default)", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_SUMMARY));
    await api.getAnalytics("tok");
    const { url } = getLastCall();
    expect(url).not.toContain("force=true");
    expect(url).toContain("/api/v1/analytics/summary");
  });

  it("appends ?force=true to the URL when force=true", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_SUMMARY));
    await api.getAnalytics("tok", true);
    const { url } = getLastCall();
    expect(url).toContain("/api/v1/analytics/summary?force=true");
  });
});
