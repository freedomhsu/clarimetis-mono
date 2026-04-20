import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoice } from "@/lib/hooks/useVoice";

// ── module mocks ──────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    transcribeAudio: vi.fn(),
  },
}));

import { api } from "@/lib/api";

const mockApi = api as { transcribeAudio: ReturnType<typeof vi.fn> };

// ── MediaRecorder mock factory ────────────────────────────────────────────

class MockMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }

  static isTypeSupported = vi.fn().mockReturnValue(false);
}

// ── setup / teardown ──────────────────────────────────────────────────────

let mockStream: MediaStream;
let mockGetUserMedia: ReturnType<typeof vi.fn>;
let MockRecorder: typeof MockMediaRecorder;

beforeEach(() => {
  vi.clearAllMocks();

  // A fake MediaStream whose tracks can be stopped
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  mockStream = { getTracks: () => [track] } as unknown as MediaStream;

  mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: mockGetUserMedia },
  });

  MockRecorder = MockMediaRecorder as unknown as typeof MockMediaRecorder;
  vi.stubGlobal("MediaRecorder", MockRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── startRecording ────────────────────────────────────────────────────────

describe("useVoice — startRecording", () => {
  it("transitions state: idle → recording", async () => {
    const { result } = renderHook(() => useVoice(vi.fn()));

    expect(result.current.state).toBe("idle");

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.state).toBe("recording");
    expect(result.current.error).toBeNull();
  });

  it("sets error and stays idle when mic is denied", async () => {
    mockGetUserMedia.mockRejectedValue(new Error("NotAllowedError"));

    const { result } = renderHook(() => useVoice(vi.fn()));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toMatch(/microphone access denied/i);
  });
});

// ── stopRecording → transcription ─────────────────────────────────────────

describe("useVoice — stopRecording / transcription", () => {
  it("calls onTranscript with the transcribed text", async () => {
    mockApi.transcribeAudio.mockResolvedValue({ transcript: "hello world" });
    const onTranscript = vi.fn();

    const { result } = renderHook(() => useVoice(onTranscript));

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      result.current.stopRecording();
      // Allow onstop + async transcription to settle
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(onTranscript).toHaveBeenCalledWith("hello world");
    expect(result.current.state).toBe("idle");
  });

  it("does not call onTranscript when transcript is empty", async () => {
    mockApi.transcribeAudio.mockResolvedValue({ transcript: "" });
    const onTranscript = vi.fn();

    const { result } = renderHook(() => useVoice(onTranscript));

    await act(async () => { await result.current.startRecording(); });
    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("calls onSubscriptionError when API returns a subscription error", async () => {
    const subError = {
      code: "subscription_required" as const,
      message: "Pro required",
      upgrade_path: "/upgrade",
    };
    mockApi.transcribeAudio.mockRejectedValue(
      Object.assign(new Error("402"), { subscriptionError: subError }),
    );
    const onTranscript = vi.fn();
    const onSubscriptionError = vi.fn();

    const { result } = renderHook(() => useVoice(onTranscript, onSubscriptionError));

    await act(async () => { await result.current.startRecording(); });
    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(onSubscriptionError).toHaveBeenCalledWith(subError);
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("sets error string when transcription fails without a subscription error", async () => {
    mockApi.transcribeAudio.mockRejectedValue(new Error("500: server error"));
    const { result } = renderHook(() => useVoice(vi.fn()));

    await act(async () => { await result.current.startRecording(); });
    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.error).toMatch(/transcription failed/i);
    expect(result.current.state).toBe("idle");
  });

  it("ends in idle state after a successful transcription cycle", async () => {
    mockApi.transcribeAudio.mockResolvedValue({ transcript: "test" });

    const { result } = renderHook(() => useVoice(vi.fn()));

    await act(async () => { await result.current.startRecording(); });
    expect(result.current.state).toBe("recording");

    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 0)); // let transcription settle
    });

    expect(result.current.state).toBe("idle");
  });
});
