import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChat } from "@/lib/hooks/useChat";

// ── module mocks ──────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

// ── helpers ────────────────────────────────────────────────────────────────

import { api } from "@/lib/api";

const mockApi = api as unknown as {
  getMessages: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
};

function makeMessage(overrides = {}) {
  return {
    id: "m1",
    session_id: "sess1",
    role: "assistant" as const,
    content: "Hello",
    media_urls: null,
    crisis_flagged: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a ReadableStream from an array of string chunks. */
function makeStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: never resolve so the fire-and-forget loadMessages() call inside
  // sendMessage doesn't wipe state before assertions run.
  mockApi.getMessages.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── loadMessages ──────────────────────────────────────────────────────────

describe("useChat — loadMessages", () => {
  it("populates messages from the API", async () => {
    const msg = makeMessage();
    mockApi.getMessages.mockResolvedValue([msg]); // override for this test

    const { result } = renderHook(() => useChat("sess1"));

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(result.current.messages).toEqual([msg]);
  });

  it("swallows 404 errors silently", async () => {
    mockApi.getMessages.mockRejectedValue(new Error("404: session not found")); // override

    const { result } = renderHook(() => useChat("sess1"));

    await expect(
      act(async () => { await result.current.loadMessages(); })
    ).resolves.not.toThrow();
  });

  it("rethrows non-404 errors", async () => {
    mockApi.getMessages.mockRejectedValue(new Error("500: server error")); // override

    const { result } = renderHook(() => useChat("sess1"));

    await expect(
      act(async () => { await result.current.loadMessages(); })
    ).rejects.toThrow("500");
  });
});

// ── sendMessage — happy path ───────────────────────────────────────────────

describe("useChat — sendMessage happy path", () => {
  it("adds an optimistic user message immediately", async () => {
    mockApi.sendMessage.mockResolvedValue(makeStream("response"));
    // getMessages never resolves (set in beforeEach) so loadMessages() doesn't wipe state

    const { result } = renderHook(() => useChat("sess1"));

    act(() => { void result.current.sendMessage("hello"); });

    await waitFor(() => {
      const userMsg = result.current.messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg?.content).toBe("hello");
    });
  });

  it("appends an assistant message after the stream ends", async () => {
    mockApi.sendMessage.mockResolvedValue(makeStream("Hi there!"));

    const { result } = renderHook(() => useChat("sess1"));

    act(() => { void result.current.sendMessage("hello"); });

    await waitFor(() => {
      const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
      expect(assistantMsg?.content).toBe("Hi there!");
    });
  });

  it("clears streamingContent after the stream ends", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("chunk one"));
        controller.close();
      },
    });
    mockApi.sendMessage.mockResolvedValue(stream);

    const { result } = renderHook(() => useChat("sess1"));

    act(() => { void result.current.sendMessage("hello"); });

    await waitFor(() => {
      expect(result.current.messages.find((m) => m.role === "assistant")?.content).toBe("chunk one");
    });
    expect(result.current.streamingContent).toBe("");
  });

  it("resets isLoading to false after completion", async () => {
    mockApi.sendMessage.mockResolvedValue(makeStream("done"));

    const { result } = renderHook(() => useChat("sess1"));

    act(() => { void result.current.sendMessage("hello"); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("includes STATUS lines as thinkingStatus (not content)", async () => {
    mockApi.sendMessage.mockResolvedValue(
      makeStream("\x00STATUS\x00:Searching knowledge base\nactual answer"),
    );

    const { result } = renderHook(() => useChat("sess1"));

    act(() => { void result.current.sendMessage("hello"); });

    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.content).toBe("actual answer");
    });
    expect(result.current.thinkingStatus).toBe("");
  });
});

// ── sendMessage — abort ───────────────────────────────────────────────────

describe("useChat — abort / stopGeneration", () => {
  it("commits partial content as an assistant message when aborted", async () => {
    const encoder = new TextEncoder();
    let controllerRef: ReadableStreamDefaultController<Uint8Array>;

    // Stream that yields one chunk then never closes (until aborted)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        controller.enqueue(encoder.encode("partial content"));
        // don't close — simulate infinite stream
      },
      cancel() {
        // abort tears this down
      },
    });
    mockApi.sendMessage.mockResolvedValue(stream);
    mockApi.getMessages.mockResolvedValue([]);

    const { result } = renderHook(() => useChat("sess1"));

    // Start sending (don't await — it will hang until aborted)
    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("hello");
    });

    // Give the stream one tick to deliver the first chunk
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Abort mid-stream — use a plain Error (jsdom's DOMException doesn't
    // extend Error, so the hook's `instanceof Error` check would fail).
    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    await act(async () => {
      result.current.stopGeneration();
      controllerRef!.error(abortError);
      await sendPromise!.catch(() => {}); // AbortError is caught internally
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("partial content");
    expect(result.current.isLoading).toBe(false);
  });
});

// ── sendMessage — subscription errors ────────────────────────────────────

describe("useChat — subscription errors", () => {
  it("sets subscriptionError and removes optimistic message on 429", async () => {
    const subError = {
      code: "daily_limit_reached" as const,
      message: "Daily limit reached",
      upgrade_path: "/upgrade",
    };
    const err = Object.assign(new Error("429"), { subscriptionError: subError });
    mockApi.sendMessage.mockRejectedValue(err);

    const { result } = renderHook(() => useChat("sess1"));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(result.current.subscriptionError).toEqual(subError);
    // The optimistic user message should have been rolled back
    expect(result.current.messages.find((m) => m.role === "user")).toBeUndefined();
  });

  it("clears subscriptionError when setSubscriptionError(null) is called", async () => {
    const subError = {
      code: "subscription_required" as const,
      message: "Pro required",
      upgrade_path: "/upgrade",
    };
    const err = Object.assign(new Error("402"), { subscriptionError: subError });
    mockApi.sendMessage.mockRejectedValue(err);

    const { result } = renderHook(() => useChat("sess1"));

    await act(async () => {
      await result.current.sendMessage("hello");
    });
    expect(result.current.subscriptionError).not.toBeNull();

    act(() => {
      result.current.setSubscriptionError(null);
    });

    expect(result.current.subscriptionError).toBeNull();
  });
});

// ── sendMessage — deferred loadMessages (response-persistence regression) ─

describe("useChat — deferred loadMessages after stream", () => {
  it("keeps the assistant message visible immediately after stream ends", async () => {
    // Regression guard: the response must remain in state right after streaming
    // completes, before the deferred loadMessages() runs (800 ms later).
    // The beforeEach mock makes getMessages never resolve, so it cannot wipe state.
    mockApi.sendMessage.mockResolvedValue(makeStream("Hi there!"));

    const { result } = renderHook(() => useChat("sess1"));

    act(() => { void result.current.sendMessage("hello"); });

    await waitFor(() => {
      expect(result.current.messages.find((m) => m.role === "assistant")?.content).toBe("Hi there!");
    });

    // getMessages was called for initial load only (still pending/never resolves),
    // so it cannot have overwritten state — message must still be present.
    expect(result.current.messages.find((m) => m.role === "assistant")?.content).toBe("Hi there!");
  });

  it("calls loadMessages via setTimeout (not immediately) after stream ends", async () => {
    // Verify that the reload is scheduled with a delay rather than fired synchronously.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    mockApi.sendMessage.mockResolvedValue(makeStream("response"));

    const { result } = renderHook(() => useChat("sess1"));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    // A setTimeout call should have been made for the deferred loadMessages.
    // The delay must be > 0 (i.e. not an immediate call).
    const deferredCalls = setTimeoutSpy.mock.calls.filter(
      ([_fn, delay]) => typeof delay === "number" && delay > 0
    );
    expect(deferredCalls.length).toBeGreaterThan(0);

    setTimeoutSpy.mockRestore();
  });
});
