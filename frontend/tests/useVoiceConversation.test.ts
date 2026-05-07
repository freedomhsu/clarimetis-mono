import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVoiceConversation } from "@/lib/hooks/useVoiceConversation";

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

vi.mock("@/lib/api", () => ({
  api: { voiceConversation: vi.fn() },
}));

import { api } from "@/lib/api";
const mockApi = api as unknown as { voiceConversation: ReturnType<typeof vi.fn> };

// ── MockMediaRecorder ─────────────────────────────────────────────────────

let lastRecorder: MockMediaRecorder | null = null;

class MockMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, _opts?: { mimeType?: string }) {
    lastRecorder = this;
  }

  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
  }

  stop() {
    if (this.state !== "inactive") {
      this.state = "inactive";
      this.onstop?.();
    }
  }

  static isTypeSupported = vi.fn().mockReturnValue(false);
}

// ── MockAudio ─────────────────────────────────────────────────────────────
// Captures the last created instance so tests can fire onended / trigger
// autoplay rejection.

let lastAudio: MockAudio | null = null;

class MockAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();

  constructor(_src: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastAudio = this;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function fakeAudioDataUri(): string {
  return `data:audio/mpeg;base64,${btoa(String.fromCharCode(0xff, 0xfb, 0x90))}`;
}

function fakeVoiceResponse(overrides: Record<string, unknown> = {}) {
  return {
    user_transcript: "I feel anxious",
    assistant_text: "That is understandable.",
    audio_data: fakeAudioDataUri(),
    crisis_flagged: false,
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────

let mockStream: MediaStream;
let mockGetUserMedia: ReturnType<typeof vi.fn>;
let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  lastRecorder = null;
  lastAudio = null;

  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  mockStream = { getTracks: () => [track] } as unknown as MediaStream;

  mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: mockGetUserMedia },
  });
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  vi.stubGlobal("Audio", MockAudio);

  createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/test");
  revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  createObjectURLSpy.mockRestore();
  revokeObjectURLSpy.mockRestore();
});

// ── Initial state ─────────────────────────────────────────────────────────

describe("useVoiceConversation — initial state", () => {
  it("starts in idle with empty turns and no errors", () => {
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    expect(result.current.convState).toBe("idle");
    expect(result.current.turns).toHaveLength(0);
    expect(result.current.hasCrisis).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.subscriptionError).toBeNull();
    expect(result.current.audioBlocked).toBe(false);
  });
});

// ── startRecording / mic denied ───────────────────────────────────────────

describe("useVoiceConversation — startRecording()", () => {
  it("transitions to recording state after mic is granted", async () => {
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });

    expect(result.current.convState).toBe("recording");
  });

  it("clears previous error and subscriptionError on each new attempt", async () => {
    mockApi.voiceConversation.mockRejectedValue(new Error("first error"));
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // Second attempt clears the previous error before recording starts
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.error).toBeNull();
    expect(result.current.subscriptionError).toBeNull();
  });

  it("sets error state when microphone access is denied", async () => {
    mockGetUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });

    expect(result.current.convState).toBe("error");
    expect(result.current.error).toMatch(/microphone access denied/i);
  });
});

// ── Happy-path conversation flow ──────────────────────────────────────────

describe("useVoiceConversation — happy-path turn", () => {
  beforeEach(() => {
    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse());
  });

  it("appends a user turn and an assistant turn after a completed recording", async () => {
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => {
      expect(result.current.turns).toHaveLength(2);
    });

    expect(result.current.turns[0]).toMatchObject({ role: "user", text: "I feel anxious" });
    expect(result.current.turns[1]).toMatchObject({
      role: "assistant",
      text: "That is understandable.",
      crisis_flagged: false,
    });
  });

  it("transitions to speaking state while audio plays", async () => {
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => expect(result.current.convState).toBe("speaking"));
    expect(lastAudio!.play).toHaveBeenCalledTimes(1);
  });

  it("calls voiceConversation with the session ID and auth token", async () => {
    const { result } = renderHook(() => useVoiceConversation("my-session-id"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => expect(mockApi.voiceConversation).toHaveBeenCalled());

    const [token, sessionId] = mockApi.voiceConversation.mock.calls[0] as [string, string];
    expect(token).toBe("test-token");
    expect(sessionId).toBe("my-session-id");
  });

  it("creates a Blob URL for the audio data and passes it to Audio constructor", async () => {
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => expect(result.current.convState).toBe("speaking"));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy.mock.calls[0][0]).toBeInstanceOf(Blob);
  });

  it("returns to idle when audio.onended fires", async () => {
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));

    act(() => { lastAudio!.onended?.(); });

    await waitFor(() => expect(result.current.convState).toBe("idle"));
  });

  it("revokes the Blob URL when audio.onended fires", async () => {
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));

    act(() => { lastAudio!.onended?.(); });
    await waitFor(() => expect(result.current.convState).toBe("idle"));

    expect(revokeObjectURLSpy).toHaveBeenCalled();
  });

  it("accumulates turns across multiple recording rounds", async () => {
    const responses = [
      fakeVoiceResponse({ user_transcript: "Turn one", assistant_text: "Reply one" }),
      fakeVoiceResponse({ user_transcript: "Turn two", assistant_text: "Reply two" }),
    ];
    let callIdx = 0;
    mockApi.voiceConversation.mockImplementation(() => Promise.resolve(responses[callIdx++]));

    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    // First turn
    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));
    act(() => { lastAudio!.onended?.(); });
    await waitFor(() => expect(result.current.convState).toBe("idle"));

    // Second turn
    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.turns).toHaveLength(4));

    expect(result.current.turns[0].text).toBe("Turn one");
    expect(result.current.turns[1].text).toBe("Reply one");
    expect(result.current.turns[2].text).toBe("Turn two");
    expect(result.current.turns[3].text).toBe("Reply two");
  });
});

// ── Crisis detection ──────────────────────────────────────────────────────

describe("useVoiceConversation — hasCrisis", () => {
  it("is false when no turns are flagged", async () => {
    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse({ crisis_flagged: false }));
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));

    expect(result.current.hasCrisis).toBe(false);
  });

  it("becomes true when an assistant turn is crisis-flagged", async () => {
    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse({ crisis_flagged: true }));
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));

    expect(result.current.hasCrisis).toBe(true);
  });
});

// ── Autoplay blocked ──────────────────────────────────────────────────────

describe("useVoiceConversation — autoplay blocked", () => {
  it("sets audioBlocked and stays idle when play() rejects with NotAllowedError", async () => {
    // Use a subclass where play() always rejects with NotAllowedError
    class BlockedAudio extends MockAudio {
      play = vi.fn().mockRejectedValue(new DOMException("autoplay blocked", "NotAllowedError"));
    }
    vi.stubGlobal("Audio", BlockedAudio);

    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse());
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => {
      expect(result.current.audioBlocked).toBe(true);
      expect(result.current.convState).toBe("idle");
    });
  });

  it("resumeAudio() calls play() on the buffered audio element", async () => {
    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse());
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));

    // Pause and resume
    act(() => { result.current.stopSpeaking(); });
    expect(result.current.convState).toBe("idle");

    act(() => { result.current.resumeAudio(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));
    // play() called once initially + once on resume
    expect(lastAudio!.play).toHaveBeenCalledTimes(2);
  });
});

// ── stopSpeaking ──────────────────────────────────────────────────────────

describe("useVoiceConversation — stopSpeaking()", () => {
  it("pauses audio and returns to idle state", async () => {
    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse());
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));

    act(() => { result.current.stopSpeaking(); });

    expect(result.current.convState).toBe("idle");
    expect(lastAudio!.pause).toHaveBeenCalledTimes(1);
  });
});

// ── Error handling ────────────────────────────────────────────────────────

describe("useVoiceConversation — error handling", () => {
  it("sets convState to error with the backend message on a plain string error", async () => {
    mockApi.voiceConversation.mockRejectedValue(
      new Error("Recording was too short or silent -- please try again.")
    );
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => expect(result.current.convState).toBe("error"));
    expect(result.current.error).toBe("Recording was too short or silent -- please try again.");
  });

  it("uses a generic fallback for unexpected errors without a message", async () => {
    mockApi.voiceConversation.mockRejectedValue("not an Error object");
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => expect(result.current.convState).toBe("error"));
    expect(result.current.error).toMatch(/something went wrong/i);
  });

  it("sets subscriptionError (not error) on a 402 subscription error", async () => {
    const subError = {
      code: "subscription_required" as const,
      message: "Pro required",
      upgrade_path: "/upgrade",
    };
    mockApi.voiceConversation.mockRejectedValue(
      Object.assign(new Error("402"), { subscriptionError: subError })
    );
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    await waitFor(() => expect(result.current.subscriptionError).not.toBeNull());
    expect(result.current.subscriptionError?.code).toBe("subscription_required");
    expect(result.current.error).toBeNull(); // error field must stay null
    expect(result.current.convState).toBe("error");
  });

  it("ignores AbortError so reset() mid-flight does not produce a false error", async () => {
    // API hangs until the signal is aborted
    mockApi.voiceConversation.mockImplementation(
      (_t: string, _s: string, _b: Blob, signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );

    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });

    // Wait until the API call is in-flight (thinking state)
    await waitFor(() => expect(result.current.convState).toBe("thinking"));

    // reset() aborts the fetch and clears state
    act(() => { result.current.reset(); });

    await waitFor(() => expect(result.current.convState).toBe("idle"));
    expect(result.current.error).toBeNull(); // AbortError must not surface as an error
  });
});

// ── reset() ───────────────────────────────────────────────────────────────

describe("useVoiceConversation — reset()", () => {
  it("clears error, subscriptionError, and audioBlocked and returns to idle", async () => {
    mockApi.voiceConversation.mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("error"));

    act(() => { result.current.reset(); });

    expect(result.current.convState).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.subscriptionError).toBeNull();
    expect(result.current.audioBlocked).toBe(false);
  });

  it("pauses any playing audio when called", async () => {
    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse());
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));

    act(() => { result.current.reset(); });

    expect(lastAudio!.pause).toHaveBeenCalled();
  });

  it("revokes any outstanding Blob URL when called", async () => {
    mockApi.voiceConversation.mockResolvedValue(fakeVoiceResponse());
    const { result } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("speaking"));

    revokeObjectURLSpy.mockClear(); // only count calls from reset()
    act(() => { result.current.reset(); });

    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:http://localhost/test");
  });
});

// ── Cleanup on unmount ────────────────────────────────────────────────────

describe("useVoiceConversation — cleanup on unmount", () => {
  it("releases microphone tracks when unmounted while recording", async () => {
    const { result, unmount } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });

    const track = mockStream.getTracks()[0] as unknown as { stop: ReturnType<typeof vi.fn> };
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it("aborts any in-flight fetch when unmounted during thinking state", async () => {
    let abortCalled = false;
    mockApi.voiceConversation.mockImplementation(
      (_t: string, _s: string, _b: Blob, signal: AbortSignal) => {
        signal.addEventListener("abort", () => { abortCalled = true; });
        return new Promise<never>(() => {}); // hang forever
      }
    );

    const { result, unmount } = renderHook(() => useVoiceConversation("sess-1"));

    await act(async () => { await result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await waitFor(() => expect(result.current.convState).toBe("thinking"));

    unmount();

    expect(abortCalled).toBe(true);
  });
});
