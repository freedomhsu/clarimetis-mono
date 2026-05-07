import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaRecorder } from "@/lib/hooks/useMediaRecorder";

// ── MockMediaRecorder ─────────────────────────────────────────────────────
//
// Exposes `lastRecorder` so tests can inspect the recorder instance that was
// created and directly fire its `onerror` / `onstop` handlers.

let lastRecorder: MockMediaRecorder | null = null;

class MockMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    lastRecorder = this;
  }

  start() {
    this.state = "recording";
    // Emit one audio chunk immediately, mirroring real browser behaviour.
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
  }

  stop() {
    if (this.state !== "inactive") {
      this.state = "inactive";
      this.onstop?.();
    }
  }

  static isTypeSupported = vi.fn().mockReturnValue(false);
}

// ── Test helpers ──────────────────────────────────────────────────────────

let mockStream: MediaStream;
let mockGetUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  lastRecorder = null;

  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  mockStream = { getTracks: () => [track] } as unknown as MediaStream;

  mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: mockGetUserMedia },
  });
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── start() ───────────────────────────────────────────────────────────────

describe("useMediaRecorder — start()", () => {
  it("requests microphone access with audio:true and transitions to isRecording", async () => {
    const { result } = renderHook(() => useMediaRecorder({ onStop: vi.fn() }));

    await act(async () => { await result.current.start(); });

    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(result.current.isRecording).toBe(true);
    expect(result.current.recordingSeconds).toBe(0);
  });

  it("calls onError and stays not-recording when mic is denied", async () => {
    mockGetUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const onError = vi.fn();

    const { result } = renderHook(() => useMediaRecorder({ onStop: vi.fn(), onError }));

    await act(async () => { await result.current.start(); });

    expect(result.current.isRecording).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/microphone access denied/i));
  });

  it("passes mimeType option to MediaRecorder when isTypeSupported is true", async () => {
    MockMediaRecorder.isTypeSupported.mockReturnValue(true);
    const { result } = renderHook(() => useMediaRecorder({ onStop: vi.fn() }));

    await act(async () => { await result.current.start(); });

    // The recorder should have the full codec string (not stripped)
    expect(lastRecorder!.mimeType).toBe("audio/webm;codecs=opus");
  });

  it("creates MediaRecorder with no mimeType option when isTypeSupported is false", async () => {
    MockMediaRecorder.isTypeSupported.mockReturnValue(false);
    const { result } = renderHook(() => useMediaRecorder({ onStop: vi.fn() }));

    await act(async () => { await result.current.start(); });

    // Our mock defaults to "audio/webm" when no option is given
    expect(lastRecorder!.mimeType).toBe("audio/webm");
  });
});

// ── stop() and onStop callback ────────────────────────────────────────────

describe("useMediaRecorder — stop()", () => {
  it("calls onStop with a Blob and the stripped MIME type", async () => {
    MockMediaRecorder.isTypeSupported.mockReturnValue(true);
    const onStop = vi.fn();

    const { result } = renderHook(() => useMediaRecorder({ onStop }));

    await act(async () => { await result.current.start(); });
    await act(async () => { result.current.stop(); });

    expect(onStop).toHaveBeenCalledTimes(1);
    const [blob, mimeType] = onStop.mock.calls[0] as [Blob, string];
    expect(blob).toBeInstanceOf(Blob);
    // "audio/webm;codecs=opus" → strips the codec → "audio/webm"
    expect(mimeType).toBe("audio/webm");
  });

  it("assembles multiple ondataavailable chunks into a single Blob", async () => {
    const onStop = vi.fn();
    const { result } = renderHook(() => useMediaRecorder({ onStop }));

    await act(async () => { await result.current.start(); });

    // Fire a second chunk directly via the recorder
    act(() => {
      lastRecorder!.ondataavailable?.({ data: new Blob(["more"], { type: "audio/webm" }) });
    });

    await act(async () => { result.current.stop(); });

    const [blob] = onStop.mock.calls[0] as [Blob, string];
    // "chunk" (5) + "more" (4) = 9 bytes
    expect(blob.size).toBe(9);
  });

  it("transitions isRecording to false", async () => {
    const { result } = renderHook(() => useMediaRecorder({ onStop: vi.fn() }));

    await act(async () => { await result.current.start(); });
    expect(result.current.isRecording).toBe(true);

    await act(async () => { result.current.stop(); });
    expect(result.current.isRecording).toBe(false);
  });

  it("resets recordingSeconds to 0 after stop", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMediaRecorder({ onStop: vi.fn() }));

    await act(async () => { await result.current.start(); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.recordingSeconds).toBe(3);

    await act(async () => { result.current.stop(); });
    expect(result.current.recordingSeconds).toBe(0);
  });

  it("is a safe no-op when not currently recording", () => {
    const onStop = vi.fn();
    const { result } = renderHook(() => useMediaRecorder({ onStop }));

    // No start() called — stop() should not throw or call onStop
    act(() => { result.current.stop(); });

    expect(onStop).not.toHaveBeenCalled();
  });
});

// ── Timers ────────────────────────────────────────────────────────────────

describe("useMediaRecorder — timers", () => {
  it("increments recordingSeconds once per second", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMediaRecorder({ onStop: vi.fn() }));

    await act(async () => { await result.current.start(); });
    act(() => { vi.advanceTimersByTime(3000); });

    expect(result.current.recordingSeconds).toBe(3);
  });

  it("auto-stops recording after maxRecordingMs", async () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const { result } = renderHook(() =>
      useMediaRecorder({ onStop, maxRecordingMs: 5000 })
    );

    await act(async () => { await result.current.start(); });
    act(() => { vi.advanceTimersByTime(5000); });

    expect(result.current.isRecording).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not auto-stop before maxRecordingMs elapses", async () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const { result } = renderHook(() =>
      useMediaRecorder({ onStop, maxRecordingMs: 5000 })
    );

    await act(async () => { await result.current.start(); });
    act(() => { vi.advanceTimersByTime(4999); });

    expect(result.current.isRecording).toBe(true);
    expect(onStop).not.toHaveBeenCalled();
  });
});

// ── onerror handling ──────────────────────────────────────────────────────

describe("useMediaRecorder — MediaRecorder.onerror", () => {
  it("calls onError and resets isRecording when the recorder fires onerror", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMediaRecorder({ onStop: vi.fn(), onError })
    );

    await act(async () => { await result.current.start(); });
    expect(result.current.isRecording).toBe(true);

    act(() => { lastRecorder!.onerror?.(); });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingSeconds).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/recording failed/i));
  });
});

// ── Cleanup on unmount ────────────────────────────────────────────────────

describe("useMediaRecorder — cleanup on unmount", () => {
  it("stops all microphone tracks when unmounted while recording", async () => {
    const { result, unmount } = renderHook(() =>
      useMediaRecorder({ onStop: vi.fn() })
    );

    await act(async () => { await result.current.start(); });

    const track = mockStream.getTracks()[0] as unknown as { stop: ReturnType<typeof vi.fn> };
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it("nulls recorder.onstop before stopping on unmount so onStop is not called", async () => {
    const onStop = vi.fn();
    const { result, unmount } = renderHook(() =>
      useMediaRecorder({ onStop })
    );

    await act(async () => { await result.current.start(); });
    // The cleanup sets `recorder.onstop = null` before calling `recorder.stop()`.
    // The mock fires `this.onstop?.()` — because it was nulled first, onStop
    // must not be invoked after unmount.
    unmount();

    expect(onStop).not.toHaveBeenCalled();
  });
});
