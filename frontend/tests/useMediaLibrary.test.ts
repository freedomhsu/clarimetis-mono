/**
 * Unit tests for lib/hooks/useMediaLibrary.ts
 *
 * All external dependencies (Clerk auth, api) are mocked.
 * The hook's useEffect fires on mount in each renderHook call.
 * Default listMedia mock never resolves so individual tests have full
 * control over when (and whether) the load completes.
 *
 * Covers:
 *  - Initial load: ready, gated, error, null token, unmount abort guard
 *  - storageUsedBytes: empty, summed from multiple files
 *  - handleDelete: first click (confirm), second click (execute), error path, null token
 *  - cancelDelete: clears confirmDelete
 *  - reload: triggers a fresh listMedia call
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMediaLibrary } from "@/lib/hooks/useMediaLibrary";
import type { MediaFile } from "@/lib/api";

// ── module mocks ──────────────────────────────────────────────────────────
//
// vi.hoisted ensures mockGetToken is initialised before vi.mock factories run
// so we can update it per-test in beforeEach.

const mockGetToken = vi.hoisted(() => vi.fn<[], Promise<string | null>>());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listMedia: vi.fn(),
    deleteMedia: vi.fn(),
  },
}));

import { api } from "@/lib/api";

const mockApi = api as unknown as {
  listMedia: ReturnType<typeof vi.fn>;
  deleteMedia: ReturnType<typeof vi.fn>;
};

// ── helpers ────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    blob_path: "uploads/user_test/abc_photo.jpg",
    filename: "photo.jpg",
    content_type: "image/jpeg",
    size_bytes: 1024,
    uploaded_at: "2026-05-01T10:00:00Z",
    url: "https://storage.example.com/signed",
    ...overrides,
  };
}

function makeSubscriptionError() {
  const err = new Error("This feature requires a Pro subscription.") as Error & {
    subscriptionError: { code: string; message: string; upgrade_path: string };
  };
  err.subscriptionError = {
    code: "subscription_required",
    message: "This feature requires a Pro subscription.",
    upgrade_path: "/pricing",
  };
  return err;
}

// ── setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetToken.mockResolvedValue("test-token");
  // Default: never settle — each test overrides this when it needs the load to complete.
  mockApi.listMedia.mockImplementation(() => new Promise(() => {}));
  mockApi.deleteMedia.mockResolvedValue(undefined);
});

// ── initial load ──────────────────────────────────────────────────────────

describe("useMediaLibrary — initial load", () => {
  it("starts in 'loading' status", () => {
    const { result } = renderHook(() => useMediaLibrary());
    // React initial state + the setStatus("loading") call inside load() both land here.
    expect(result.current.status).toBe("loading");
  });

  it("sets status to 'ready' and populates files when listMedia resolves", async () => {
    const file = makeFile();
    mockApi.listMedia.mockResolvedValue([file]);

    const { result } = renderHook(() => useMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.files).toEqual([file]);
    expect(mockApi.listMedia).toHaveBeenCalledWith("test-token");
  });

  it("sets status to 'gated' on subscription_required error", async () => {
    mockApi.listMedia.mockRejectedValue(makeSubscriptionError());

    const { result } = renderHook(() => useMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe("gated"));
    // error must not be set — the page shows the upgrade gate, not a banner
    expect(result.current.error).toBeNull();
  });

  it("sets status to 'error' and populates error message on a generic error", async () => {
    mockApi.listMedia.mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Network failure");
  });

  it("does not call listMedia when getToken returns null", async () => {
    mockGetToken.mockResolvedValue(null);

    const { result } = renderHook(() => useMediaLibrary());

    // Flush the microtask in which getToken resolves and the early return fires.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApi.listMedia).not.toHaveBeenCalled();
    // The hook has no path to progress without a token — stays loading.
    expect(result.current.status).toBe("loading");
  });

  it("does not update state after unmount (AbortController guard)", async () => {
    let resolveList!: (files: MediaFile[]) => void;
    mockApi.listMedia.mockReturnValue(
      new Promise<MediaFile[]>((res) => {
        resolveList = res;
      }),
    );

    const { result, unmount } = renderHook(() => useMediaLibrary());
    // Hook is in loading state; listMedia is in-flight.

    unmount(); // triggers controller.abort()

    // Resolve the in-flight call — the abort guard inside load() must swallow this.
    await act(async () => {
      resolveList([makeFile()]);
    });

    // State must not have been updated after unmount.
    expect(result.current.files).toEqual([]);
    expect(result.current.status).toBe("loading");
  });
});

// ── storageUsedBytes ──────────────────────────────────────────────────────

describe("useMediaLibrary — storageUsedBytes", () => {
  it("is 0 when no files are loaded", async () => {
    mockApi.listMedia.mockResolvedValue([]);

    const { result } = renderHook(() => useMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.storageUsedBytes).toBe(0);
  });

  it("sums all file sizes correctly", async () => {
    const files = [
      makeFile({ size_bytes: 1000 }),
      makeFile({ blob_path: "uploads/user_test/b.jpg", size_bytes: 2500 }),
    ];
    mockApi.listMedia.mockResolvedValue(files);

    const { result } = renderHook(() => useMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.storageUsedBytes).toBe(3500);
  });
});

// ── handleDelete ──────────────────────────────────────────────────────────

describe("useMediaLibrary — handleDelete", () => {
  const BLOB_PATH = "uploads/user_test/abc_photo.jpg";

  /** Render the hook with one file already loaded. */
  async function renderWithFile() {
    mockApi.listMedia.mockResolvedValue([makeFile()]);
    const rendered = renderHook(() => useMediaLibrary());
    await waitFor(() => expect(rendered.result.current.status).toBe("ready"));
    return rendered;
  }

  it("first call sets confirmDelete without calling deleteMedia", async () => {
    const { result } = await renderWithFile();

    await act(async () => {
      await result.current.handleDelete(BLOB_PATH);
    });

    expect(result.current.confirmDelete).toBe(BLOB_PATH);
    expect(mockApi.deleteMedia).not.toHaveBeenCalled();
  });

  it("second call with the same path executes deletion and removes the file", async () => {
    const { result } = await renderWithFile();

    // First call: stage for confirmation.
    await act(async () => {
      await result.current.handleDelete(BLOB_PATH);
    });
    expect(result.current.confirmDelete).toBe(BLOB_PATH);

    // Second call: confirm — result.current.handleDelete is now a new closure
    // that sees confirmDelete === BLOB_PATH.
    await act(async () => {
      await result.current.handleDelete(BLOB_PATH);
    });

    expect(mockApi.deleteMedia).toHaveBeenCalledWith("test-token", BLOB_PATH);
    expect(result.current.files).toHaveLength(0);
    expect(result.current.deleting).toBeNull();
    expect(result.current.confirmDelete).toBeNull();
  });

  it("on delete failure sets error and keeps the file in the list", async () => {
    mockApi.deleteMedia.mockRejectedValue(new Error("Storage unavailable"));
    const { result } = await renderWithFile();

    await act(async () => {
      await result.current.handleDelete(BLOB_PATH);
    });
    await act(async () => {
      await result.current.handleDelete(BLOB_PATH);
    });

    expect(result.current.error).toBe("Storage unavailable");
    // finally block always clears deleting
    expect(result.current.deleting).toBeNull();
    // File must NOT be removed — no optimistic removal on failure
    expect(result.current.files).toHaveLength(1);
  });

  it("does not call deleteMedia when getToken returns null after confirmation", async () => {
    const { result } = await renderWithFile();

    // Stage for confirmation.
    await act(async () => {
      await result.current.handleDelete(BLOB_PATH);
    });

    // Null token on the actual delete attempt.
    mockGetToken.mockResolvedValue(null);
    await act(async () => {
      await result.current.handleDelete(BLOB_PATH);
    });

    expect(mockApi.deleteMedia).not.toHaveBeenCalled();
    // File must still be present — the token guard returned before removing it.
    expect(result.current.files).toHaveLength(1);
  });
});

// ── cancelDelete ──────────────────────────────────────────────────────────

describe("useMediaLibrary — cancelDelete", () => {
  it("clears confirmDelete without calling deleteMedia", async () => {
    mockApi.listMedia.mockResolvedValue([makeFile()]);
    const { result } = renderHook(() => useMediaLibrary());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Stage the deletion.
    await act(async () => {
      await result.current.handleDelete("uploads/user_test/abc_photo.jpg");
    });
    expect(result.current.confirmDelete).toBe("uploads/user_test/abc_photo.jpg");

    // Cancel.
    act(() => {
      result.current.cancelDelete();
    });

    expect(result.current.confirmDelete).toBeNull();
    expect(mockApi.deleteMedia).not.toHaveBeenCalled();
  });
});

// ── reload ────────────────────────────────────────────────────────────────

describe("useMediaLibrary — reload", () => {
  it("triggers a fresh listMedia call and updates the file list", async () => {
    const fileV1 = makeFile({ filename: "v1.jpg" });
    const fileV2 = makeFile({ filename: "v2.jpg" });

    // Initial load returns v1.
    mockApi.listMedia.mockResolvedValueOnce([fileV1]);
    const { result } = renderHook(() => useMediaLibrary());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.files[0].filename).toBe("v1.jpg");

    // Reload returns v2.
    mockApi.listMedia.mockResolvedValueOnce([fileV2]);
    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.files[0]?.filename).toBe("v2.jpg"));
    // Exactly two calls: initial load + reload.
    expect(mockApi.listMedia).toHaveBeenCalledTimes(2);
  });
});
