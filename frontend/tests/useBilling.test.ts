/**
 * Unit tests for lib/hooks/useBilling.ts
 *
 * All external dependencies (Clerk auth, api, window.location) are mocked.
 *
 * Covers:
 *  loadTier:
 *    - sets tier to "pro" when API returns subscription_tier="pro"
 *    - keeps tier as "free" when API returns a non-pro tier
 *    - skips the API call when getToken returns null
 *    - silently stays "free" when the API throws
 *
 *  subscribe:
 *    - redirects to /sign-in when user is not signed in
 *    - sets loading while in-flight, then redirects to the Stripe URL
 *    - handles null token — sets error, clears loading
 *    - sets error message and clears loading on API failure
 *
 *  openBillingPortal:
 *    - sets loading="portal" while in-flight, then redirects to portal URL
 *    - handles null token — sets error, clears loading
 *    - sets error message and clears loading on API failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBilling } from "@/lib/hooks/useBilling";

// ── module mocks ──────────────────────────────────────────────────────────

const mockGetToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const mockIsSignedIn = vi.hoisted(() => ({ value: true }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    get isSignedIn() {
      return mockIsSignedIn.value;
    },
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getMe: vi.fn(),
    getSubscribeUrl: vi.fn(),
    getBillingPortalUrl: vi.fn(),
  },
}));

import { api } from "@/lib/api";

const mockApi = api as unknown as {
  getMe: ReturnType<typeof vi.fn>;
  getSubscribeUrl: ReturnType<typeof vi.fn>;
  getBillingPortalUrl: ReturnType<typeof vi.fn>;
};

// ── window.location.href capture ──────────────────────────────────────────

// Captures the last value assigned to window.location.href during a test.
let capturedHref: string | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  capturedHref = null;
  mockGetToken.mockResolvedValue("test-token");
  mockIsSignedIn.value = true;

  // jsdom allows re-defining window.location; capture href assignments.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      set href(v: string) {
        capturedHref = v;
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── loadTier ───────────────────────────────────────────────────────────────

describe("useBilling — loadTier", () => {
  it("sets tier to 'pro' when the API returns subscription_tier='pro'", async () => {
    mockApi.getMe.mockResolvedValue({ subscription_tier: "pro" });
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.loadTier());
    expect(result.current.tier).toBe("pro");
  });

  it("keeps tier as 'free' when the API returns a non-pro tier", async () => {
    mockApi.getMe.mockResolvedValue({ subscription_tier: "free" });
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.loadTier());
    expect(result.current.tier).toBe("free");
  });

  it("skips the API call and keeps 'free' when getToken returns null", async () => {
    mockGetToken.mockResolvedValue(null);
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.loadTier());
    expect(mockApi.getMe).not.toHaveBeenCalled();
    expect(result.current.tier).toBe("free");
  });

  it("silently stays 'free' when the API throws", async () => {
    mockApi.getMe.mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.loadTier());
    expect(result.current.tier).toBe("free");
    expect(result.current.error).toBeNull(); // must not set error
  });
});

// ── subscribe ──────────────────────────────────────────────────────────────

describe("useBilling — subscribe", () => {
  it("redirects to /sign-in when user is not signed in", async () => {
    mockIsSignedIn.value = false;
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.subscribe("monthly"));
    expect(capturedHref).toBe("/sign-in");
    expect(mockApi.getSubscribeUrl).not.toHaveBeenCalled();
  });

  it("redirects to the Stripe checkout URL on success", async () => {
    mockApi.getSubscribeUrl.mockResolvedValue("https://checkout.stripe.com/pay/abc");
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.subscribe("monthly"));
    expect(capturedHref).toBe("https://checkout.stripe.com/pay/abc");
  });

  it("passes the chosen plan ('annual') to getSubscribeUrl", async () => {
    mockApi.getSubscribeUrl.mockResolvedValue("https://checkout.stripe.com/pay/xyz");
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.subscribe("annual"));
    expect(mockApi.getSubscribeUrl).toHaveBeenCalledWith("test-token", "annual");
  });

  it("sets loading to the plan value while in-flight", async () => {
    let resolveUrl!: (url: string) => void;
    mockApi.getSubscribeUrl.mockReturnValue(
      new Promise<string>((res) => { resolveUrl = res; }),
    );
    const { result } = renderHook(() => useBilling());
    act(() => { void result.current.subscribe("monthly"); });
    await waitFor(() => expect(result.current.loading).toBe("monthly"));
    await act(() => { resolveUrl("https://checkout.stripe.com/pay/abc"); });
  });

  it("sets error and clears loading when the API throws", async () => {
    mockApi.getSubscribeUrl.mockRejectedValue(new Error("Stripe unavailable"));
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.subscribe("monthly"));
    expect(result.current.error).toBe("Could not start checkout. Please try again.");
    expect(result.current.loading).toBeNull();
  });

  it("sets error and clears loading when getToken returns null", async () => {
    mockGetToken.mockResolvedValue(null);
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.subscribe("monthly"));
    expect(result.current.error).toBe("Could not start checkout. Please try again.");
    expect(result.current.loading).toBeNull();
  });

  it("clears a previous error before starting a new subscribe attempt", async () => {
    mockApi.getSubscribeUrl.mockRejectedValueOnce(new Error("First failure"));
    mockApi.getSubscribeUrl.mockResolvedValue("https://checkout.stripe.com/pay/ok");
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.subscribe("monthly"));
    expect(result.current.error).toBeTruthy();
    await act(() => result.current.subscribe("monthly"));
    // error must be cleared when the second attempt starts
    expect(result.current.error).toBeNull();
  });
});

// ── openBillingPortal ──────────────────────────────────────────────────────

describe("useBilling — openBillingPortal", () => {
  it("redirects to the billing portal URL on success", async () => {
    mockApi.getBillingPortalUrl.mockResolvedValue("https://billing.stripe.com/session/abc");
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.openBillingPortal());
    expect(capturedHref).toBe("https://billing.stripe.com/session/abc");
  });

  it("sets loading='portal' while in-flight", async () => {
    let resolve!: (url: string) => void;
    mockApi.getBillingPortalUrl.mockReturnValue(
      new Promise<string>((res) => { resolve = res; }),
    );
    const { result } = renderHook(() => useBilling());
    act(() => { void result.current.openBillingPortal(); });
    await waitFor(() => expect(result.current.loading).toBe("portal"));
    await act(() => { resolve("https://billing.stripe.com/session/abc"); });
  });

  it("sets error and clears loading when the API throws", async () => {
    mockApi.getBillingPortalUrl.mockRejectedValue(new Error("Portal error"));
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.openBillingPortal());
    expect(result.current.error).toBe("Could not open billing portal. Please try again.");
    expect(result.current.loading).toBeNull();
  });

  it("sets error and clears loading when getToken returns null", async () => {
    mockGetToken.mockResolvedValue(null);
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.openBillingPortal());
    expect(result.current.error).toBe("Could not open billing portal. Please try again.");
    expect(result.current.loading).toBeNull();
  });

  it("clears a previous error before starting a new portal attempt", async () => {
    mockApi.getBillingPortalUrl.mockRejectedValueOnce(new Error("First failure"));
    mockApi.getBillingPortalUrl.mockResolvedValue("https://billing.stripe.com/session/ok");
    const { result } = renderHook(() => useBilling());
    await act(() => result.current.openBillingPortal());
    expect(result.current.error).toBeTruthy();
    await act(() => result.current.openBillingPortal());
    expect(result.current.error).toBeNull();
  });
});

// ── setTier (escape hatch) ─────────────────────────────────────────────────

describe("useBilling — setTier", () => {
  it("allows external callers to set tier directly to 'pro'", () => {
    const { result } = renderHook(() => useBilling());
    act(() => result.current.setTier("pro"));
    expect(result.current.tier).toBe("pro");
  });

  it("allows external callers to set tier back to 'free'", () => {
    const { result } = renderHook(() => useBilling());
    act(() => result.current.setTier("pro"));
    act(() => result.current.setTier("free"));
    expect(result.current.tier).toBe("free");
  });
});
