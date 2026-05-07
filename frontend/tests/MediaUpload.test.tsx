/**
 * Unit tests for components/chat/MediaUpload.tsx
 *
 * All external dependencies (Clerk auth, api) are mocked.
 * The hidden file input is exercised directly via fireEvent.change so
 * tests don't depend on jsdom's pointer-event simulation for hidden elements.
 *
 * Covers:
 *  - Rendering: attach button, accept attribute, disabled state
 *  - Client-side validation: disallowed MIME type, file exceeding 30 MB
 *  - Happy path: onUploadStart → uploadMedia → onUpload called with url + blob_path
 *  - Error paths: plain network error, subscription 402 error, null auth token
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MediaUpload } from "@/components/chat/MediaUpload";
import type { SubscriptionError } from "@/lib/api";

// ── module mocks ──────────────────────────────────────────────────────────

const mockGetToken = vi.hoisted(() => vi.fn<[], Promise<string | null>>());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    uploadMedia: vi.fn(),
  },
}));

import { api } from "@/lib/api";

const mockApi = api as unknown as {
  uploadMedia: ReturnType<typeof vi.fn>;
};

// ── helpers ────────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * Create a File with an optional size override.
 * jsdom's File.size is a getter on Blob.prototype; we shadow it on the
 * instance with Object.defineProperty so we can test the > 30 MB guard
 * without allocating 31 MB of memory.
 */
function makeFile(name: string, type: string, sizeOverride?: number): File {
  const file = new File(["content"], name, { type });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, "size", {
      configurable: true,
      get: () => sizeOverride,
    });
  }
  return file;
}

/**
 * Simulate the browser setting input.files and firing the change event.
 * Using fireEvent instead of userEvent.upload so visibility doesn't matter.
 */
function uploadFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    get: () => ({
      0: file,
      length: 1,
      item: (i: number) => (i === 0 ? file : null),
    }),
  });
  fireEvent.change(input);
}

type Props = Parameters<typeof MediaUpload>[0];

function setup(props: Partial<Props> = {}) {
  const onUpload = vi.fn();
  const onUploadStart = vi.fn();
  const onUploadError = vi.fn();
  const onSubscriptionError = vi.fn();

  const { container } = render(
    <MediaUpload
      onUpload={onUpload}
      onUploadStart={onUploadStart}
      onUploadError={onUploadError}
      onSubscriptionError={onSubscriptionError}
      {...props}
    />,
  );

  const input = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;

  return { container, input, onUpload, onUploadStart, onUploadError, onSubscriptionError };
}

// ── setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetToken.mockResolvedValue("test-token");
  mockApi.uploadMedia.mockResolvedValue({
    url: "https://storage.example.com/signed",
    blob_path: "uploads/user_test/abc_photo.jpg",
    content_type: "image/jpeg",
  });
});

// ── rendering ─────────────────────────────────────────────────────────────

describe("MediaUpload — rendering", () => {
  it("renders the attach button with the correct aria-label", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /attach image, video, or pdf/i }),
    ).toBeInTheDocument();
  });

  it("renders a hidden file input that accepts image, video, and PDF types", () => {
    const { input } = setup();
    expect(input).toBeInTheDocument();
    expect(input.accept).toMatch(/image/);
    expect(input.accept).toMatch(/video/);
    expect(input.accept).toMatch(/pdf/i);
  });

  it("button is disabled when the disabled prop is true", () => {
    setup({ disabled: true });
    expect(screen.getByRole("button", { name: /attach/i })).toBeDisabled();
  });
});

// ── client-side validation ─────────────────────────────────────────────────

describe("MediaUpload — client-side validation", () => {
  it("calls onUploadError for a disallowed MIME type and does not call uploadMedia", () => {
    const { input, onUploadError } = setup();

    uploadFile(input, makeFile("script.exe", "application/octet-stream"));

    // Validation runs synchronously before the first await.
    expect(onUploadError).toHaveBeenCalledWith(
      "Unsupported file type. Please upload an image, video, or PDF.",
    );
    expect(mockApi.uploadMedia).not.toHaveBeenCalled();
  });

  it("calls onUploadError with the size-limit message for a file exceeding 30 MB", () => {
    const { input, onUploadError } = setup();

    uploadFile(input, makeFile("big.jpg", "image/jpeg", MAX_UPLOAD_BYTES + 1));

    expect(onUploadError).toHaveBeenCalledWith("File exceeds the 30 MB limit.");
    expect(mockApi.uploadMedia).not.toHaveBeenCalled();
  });

  it("does not reject a file whose size equals exactly MAX_UPLOAD_BYTES", async () => {
    // Guard is `file.size > MAX_UPLOAD_BYTES`, so exactly 30 MB must pass.
    const { input, onUploadError } = setup();

    uploadFile(input, makeFile("exact.jpg", "image/jpeg", MAX_UPLOAD_BYTES));

    await waitFor(() => expect(mockApi.uploadMedia).toHaveBeenCalled());
    expect(onUploadError).not.toHaveBeenCalled();
  });
});

// ── happy path ─────────────────────────────────────────────────────────────

describe("MediaUpload — happy path", () => {
  it("calls onUploadStart, uploadMedia, then onUpload with the url and blob_path", async () => {
    const { input, onUpload, onUploadStart } = setup();
    const file = makeFile("photo.jpg", "image/jpeg");

    uploadFile(input, file);

    await waitFor(() => expect(onUpload).toHaveBeenCalled());

    // Called in order: start signal → API → completion callback.
    expect(onUploadStart).toHaveBeenCalledOnce();
    expect(mockApi.uploadMedia).toHaveBeenCalledWith("test-token", file);
    expect(onUpload).toHaveBeenCalledWith(
      "https://storage.example.com/signed",
      "uploads/user_test/abc_photo.jpg",
    );
  });
});

// ── error paths ───────────────────────────────────────────────────────────

describe("MediaUpload — error paths", () => {
  it("calls onUploadError when uploadMedia throws a plain error", async () => {
    mockApi.uploadMedia.mockRejectedValue(new Error("Network failure"));

    const { input, onUploadError } = setup();

    uploadFile(input, makeFile("photo.jpg", "image/jpeg"));

    await waitFor(() => expect(onUploadError).toHaveBeenCalled());
    expect(onUploadError).toHaveBeenCalledWith(
      "Failed to upload file. Please try again.",
    );
  });

  it("calls onSubscriptionError (not onUploadError) for a 402 response", async () => {
    const subError = new Error("Pro required") as Error & {
      subscriptionError: SubscriptionError;
    };
    subError.subscriptionError = {
      code: "subscription_required",
      message: "This feature requires a Pro subscription.",
      upgrade_path: "/pricing",
    };
    mockApi.uploadMedia.mockRejectedValue(subError);

    const { input, onUploadError, onSubscriptionError } = setup();

    uploadFile(input, makeFile("photo.jpg", "image/jpeg"));

    await waitFor(() => expect(onSubscriptionError).toHaveBeenCalled());
    expect(onSubscriptionError).toHaveBeenCalledWith(subError.subscriptionError);
    expect(onUploadError).not.toHaveBeenCalled();
  });

  it("does not call uploadMedia or onUploadStart when getToken returns null", async () => {
    mockGetToken.mockResolvedValue(null);

    const { input, onUploadStart } = setup();

    uploadFile(input, makeFile("photo.jpg", "image/jpeg"));

    // Flush microtasks: getToken resolves → null token → early return.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApi.uploadMedia).not.toHaveBeenCalled();
    expect(onUploadStart).not.toHaveBeenCalled();
  });
});
