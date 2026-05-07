import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api";

// Store the mock fetch so tests can configure it per-case
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function subscriptionErrorResponse(
  status: 402 | 429,
  code: "subscription_required" | "daily_limit_reached",
) {
  return jsonResponse(
    {
      detail: {
        code,
        message: "Upgrade required",
        upgrade_path: "/upgrade",
      },
    },
    status,
  );
}

// ── request() — shared transport layer ────────────────────────────────────

describe("api internal request()", () => {
  it("returns parsed JSON on 200", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "s1" }));
    const result = await api.getSessions("tok");
    expect(result).toEqual({ id: "s1" });
  });

  it("throws a plain Error on non-subscription error responses", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ detail: "not found" }, 404));
    await expect(api.getSessions("tok")).rejects.toThrow("404");
  });

  it("attaches .subscriptionError on 402 with detail.code", async () => {
    mockFetch.mockResolvedValue(subscriptionErrorResponse(402, "subscription_required"));
    const err = await api.getSessions("tok").catch((e) => e);
    expect(err.subscriptionError).toBeDefined();
    expect(err.subscriptionError.code).toBe("subscription_required");
    expect(err.subscriptionError.upgrade_path).toBe("/upgrade");
  });

  it("attaches .subscriptionError on 429 with detail.code", async () => {
    mockFetch.mockResolvedValue(subscriptionErrorResponse(429, "daily_limit_reached"));
    const err = await api.getSessions("tok").catch((e) => e);
    expect(err.subscriptionError).toBeDefined();
    expect(err.subscriptionError.code).toBe("daily_limit_reached");
  });

  it("throws plain Error when 402 body has no detail.code", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ detail: "payment required" }, 402));
    const err = await api.getSessions("tok").catch((e) => e);
    expect(err.subscriptionError).toBeUndefined();
    expect(err.message).toMatch("402");
  });
});

// ── sendMessage ────────────────────────────────────────────────────────────

describe("api.sendMessage()", () => {
  it("returns the response body as a ReadableStream on success", async () => {
    const stream = new ReadableStream();
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));
    const result = await api.sendMessage("tok", "sess1", "hello");
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it("throws with .subscriptionError on 429 body", async () => {
    mockFetch.mockResolvedValue(subscriptionErrorResponse(429, "daily_limit_reached"));
    const err = await api.sendMessage("tok", "sess1", "hello").catch((e) => e);
    expect(err.subscriptionError?.code).toBe("daily_limit_reached");
  });

  it("throws plain Error when response body is missing", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(api.sendMessage("tok", "sess1", "hello")).rejects.toThrow("No response body");
  });

  it("passes Authorization header", async () => {
    const stream = new ReadableStream();
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));
    await api.sendMessage("mytoken", "sess1", "hi");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer mytoken");
  });
});

// ── uploadMedia ────────────────────────────────────────────────────────────

describe("api.uploadMedia()", () => {
  it("returns url and content_type on success", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ url: "https://storage/file.png", content_type: "image/png" }),
    );
    const result = await api.uploadMedia("tok", new File([], "file.png"));
    expect(result.url).toBe("https://storage/file.png");
  });

  it("attaches .subscriptionError on 402", async () => {
    mockFetch.mockResolvedValue(subscriptionErrorResponse(402, "subscription_required"));
    const err = await api.uploadMedia("tok", new File([], "f.png")).catch((e) => e);
    expect(err.subscriptionError?.code).toBe("subscription_required");
  });
});

// ── deleteSession ─────────────────────────────────────────────────────────

describe("api.deleteSession()", () => {
  it("resolves without error on 204", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteSession("tok", "s1")).resolves.toBeUndefined();
  });

  it("throws plain Error on 404", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ detail: "not found" }, 404));
    await expect(api.deleteSession("tok", "s1")).rejects.toThrow("404");
  });
});

// ── getMessages ────────────────────────────────────────────────────────────

describe("api.getMessages()", () => {
  it("returns an array of messages on success", async () => {
    const msgs = [
      { id: "m1", session_id: "s1", role: "user", content: "hi", media_urls: null, crisis_flagged: false, created_at: new Date().toISOString() },
    ];
    mockFetch.mockResolvedValue(jsonResponse(msgs));
    const result = await api.getMessages("tok", "s1");
    expect(result).toEqual(msgs);
  });

  it("requests the correct URL path", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await api.getMessages("tok", "sess-abc");
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/sessions\/sess-abc\/messages/);
  });

  it("throws on non-200 response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ detail: "forbidden" }, 403));
    await expect(api.getMessages("tok", "s1")).rejects.toThrow("403");
  });
});

// ── createSession / renameSession ──────────────────────────────────────────

describe("api.createSession()", () => {
  it("returns the created session", async () => {
    const session = { id: "s1", title: "New Session", summary: null, created_at: "", updated_at: "" };
    mockFetch.mockResolvedValue(jsonResponse(session));
    const result = await api.createSession("tok");
    expect(result.id).toBe("s1");
  });

  it("sends a POST request", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "s1", title: "t", summary: null, created_at: "", updated_at: "" }));
    await api.createSession("tok", "Custom title");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toContain("Custom title");
  });
});

describe("api.renameSession()", () => {
  it("returns the updated session with the new title", async () => {
    const updated = { id: "s1", title: "Renamed", summary: null, created_at: "", updated_at: "" };
    mockFetch.mockResolvedValue(jsonResponse(updated));
    const result = await api.renameSession("tok", "s1", "Renamed");
    expect(result.title).toBe("Renamed");
  });

  it("sends a PATCH request with the new title in the body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "s1", title: "Renamed", summary: null, created_at: "", updated_at: "" }));
    await api.renameSession("tok", "s1", "Renamed");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/sessions\/s1/);
    expect(init.method).toBe("PATCH");
    expect(init.body).toContain("Renamed");
  });
});

// ── sendMessage with mediaUrls ─────────────────────────────────────────────

describe("api.sendMessage() — media", () => {
  it("includes media_urls in the request body when provided", async () => {
    const stream = new ReadableStream();
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));
    await api.sendMessage("tok", "s1", "look at this", ["uploads/img.png"]);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.media_urls).toEqual(["uploads/img.png"]);
  });

  it("sends media_urls=null when no mediaUrls are provided", async () => {
    const stream = new ReadableStream();
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));
    await api.sendMessage("tok", "s1", "hello");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.media_urls).toBeNull();
  });
});
