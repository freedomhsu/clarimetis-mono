/**
 * Unit tests for components/providers/I18nContext.tsx
 *
 * Tests the I18nProvider's:
 *  - localStorage hydration after mount (reads stored language)
 *  - ignores invalid language codes in localStorage
 *  - syncs with the server preference when the user signs in
 *  - setLang() updates state, persists to localStorage, and fires the API
 *  - t() reflects the active language
 *  - cancellation guard: unmounting during the async server-sync does not cause
 *    state updates
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { I18nProvider, useI18n } from "@/components/providers/I18nContext";

// ── module mocks ──────────────────────────────────────────────────────────

const mockGetToken = vi.hoisted(() => vi.fn<[], Promise<string | null>>());
const mockIsSignedIn = vi.hoisted(() => ({ value: false }));

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
    getLanguage: vi.fn(),
    setLanguage: vi.fn(),
  },
}));

import { api } from "@/lib/api";

const mockApi = api as unknown as {
  getLanguage: ReturnType<typeof vi.fn>;
  setLanguage: ReturnType<typeof vi.fn>;
};

// ── localStorage stub ──────────────────────────────────────────────────────

// ── localStorage mock ─────────────────────────────────────────────────────
//
// jsdom's localStorage does not always expose all Storage methods reliably.
// We provide our own in-memory implementation via vi.stubGlobal.

const STORAGE_KEY = "clarimetis_lang";

function createLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, val: string): void => { store[key] = val; },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (_: number) => null,
  };
}

let mockStorage: ReturnType<typeof createLocalStorageMock>;

// ── helpers ────────────────────────────────────────────────────────────────

function setStoredLang(lang: string | null) {
  if (lang === null) {
    mockStorage.removeItem(STORAGE_KEY);
  } else {
    mockStorage.setItem(STORAGE_KEY, lang);
  }
}

// ── wrapper helper ─────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(I18nProvider, null, children);
}

// ── setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage = createLocalStorageMock();
  vi.stubGlobal("localStorage", mockStorage);
  mockGetToken.mockResolvedValue("test-token");
  mockIsSignedIn.value = false;
  // Default: getLanguage never resolves so individual tests control timing.
  mockApi.getLanguage.mockImplementation(() => new Promise(() => {}));
  mockApi.setLanguage.mockResolvedValue({ preferred_language: "en" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── initial state ──────────────────────────────────────────────────────────

describe("I18nProvider — initial state", () => {
  it("starts with lang='en' (safe server-rendered default)", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.lang).toBe("en");
  });

  it("exposes a t() function that translates 'en' keys correctly", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t("nav_dashboard")).toBe("Dashboard");
  });
});

// ── localStorage hydration ─────────────────────────────────────────────────

describe("I18nProvider — localStorage hydration", () => {
  it("applies a valid non-English lang stored in localStorage", async () => {
    setStoredLang("es");
    const { result } = renderHook(() => useI18n(), { wrapper });
    await waitFor(() => expect(result.current.lang).toBe("es"));
  });

  it("does NOT change lang when localStorage contains 'en' (avoids re-render noise)", async () => {
    setStoredLang("en");
    const { result } = renderHook(() => useI18n(), { wrapper });
    // Give any effects time to run
    await act(async () => {});
    expect(result.current.lang).toBe("en");
  });

  it("ignores an invalid lang code in localStorage", async () => {
    setStoredLang("xx");
    const { result } = renderHook(() => useI18n(), { wrapper });
    await act(async () => {});
    expect(result.current.lang).toBe("en");
  });

  it("ignores null (no stored lang)", async () => {
    setStoredLang(null);
    const { result } = renderHook(() => useI18n(), { wrapper });
    await act(async () => {});
    expect(result.current.lang).toBe("en");
  });
});

// ── server sync ────────────────────────────────────────────────────────────

describe("I18nProvider — server sync on sign-in", () => {
  it("does NOT call getLanguage when isSignedIn=false", async () => {
    mockIsSignedIn.value = false;
    renderHook(() => useI18n(), { wrapper });
    await act(async () => {});
    expect(mockApi.getLanguage).not.toHaveBeenCalled();
  });

  it("calls getLanguage when isSignedIn=true and applies the server lang", async () => {
    mockIsSignedIn.value = true;
    mockApi.getLanguage.mockResolvedValue({ preferred_language: "ja" });
    const { result } = renderHook(() => useI18n(), { wrapper });
    await waitFor(() => expect(result.current.lang).toBe("ja"));
    expect(mockApi.getLanguage).toHaveBeenCalledWith("test-token");
  });

  it("persists the server lang to localStorage after sync", async () => {
    mockIsSignedIn.value = true;
    mockApi.getLanguage.mockResolvedValue({ preferred_language: "ko" });
    renderHook(() => useI18n(), { wrapper });
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe("ko"));
  });

  it("silently ignores getLanguage errors and keeps the current lang", async () => {
    mockIsSignedIn.value = true;
    mockApi.getLanguage.mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useI18n(), { wrapper });
    await act(async () => {});
    expect(result.current.lang).toBe("en");
  });

  it("ignores an invalid preferred_language from the server", async () => {
    mockIsSignedIn.value = true;
    mockApi.getLanguage.mockResolvedValue({ preferred_language: "zz" });
    const { result } = renderHook(() => useI18n(), { wrapper });
    await act(async () => {});
    expect(result.current.lang).toBe("en");
  });

  it("skips state update when getToken returns null", async () => {
    mockIsSignedIn.value = true;
    mockGetToken.mockResolvedValue(null);
    mockApi.getLanguage.mockResolvedValue({ preferred_language: "es" });
    const { result } = renderHook(() => useI18n(), { wrapper });
    await act(async () => {});
    expect(mockApi.getLanguage).not.toHaveBeenCalled();
    expect(result.current.lang).toBe("en");
  });
});

// ── setLang ────────────────────────────────────────────────────────────────

describe("I18nProvider — setLang()", () => {
  it("updates the lang state immediately", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLang("fr"));
    expect(result.current.lang).toBe("fr");
  });

  it("persists the new lang to localStorage", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLang("pt"));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("pt");
  });

  it("fires api.setLanguage with the token and new lang", async () => {
    mockApi.setLanguage.mockResolvedValue({ preferred_language: "it" });
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLang("it"));
    await waitFor(() => expect(mockApi.setLanguage).toHaveBeenCalledWith("test-token", "it"));
  });

  it("does NOT call api.setLanguage when getToken returns null", async () => {
    mockGetToken.mockResolvedValue(null);
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLang("es"));
    await act(async () => {});
    expect(mockApi.setLanguage).not.toHaveBeenCalled();
  });

  it("silently swallows api.setLanguage errors", async () => {
    mockApi.setLanguage.mockRejectedValue(new Error("API down"));
    const { result } = renderHook(() => useI18n(), { wrapper });
    await act(async () => result.current.setLang("zh-TW"));
    // No throw, lang state is still updated
    expect(result.current.lang).toBe("zh-TW");
  });

  it("updates t() to reflect the new language after setLang", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLang("es"));
    // Spanish nav_dashboard is "Inicio"
    expect(result.current.t("nav_dashboard")).toBe("Inicio");
  });
});

// ── cancellation guard on unmount ──────────────────────────────────────────

describe("I18nProvider — unmount during async server sync", () => {
  it("does not attempt a state update after unmount", async () => {
    mockIsSignedIn.value = true;
    let resolveGetLang!: (v: { preferred_language: string }) => void;
    mockApi.getLanguage.mockReturnValue(
      new Promise<{ preferred_language: string }>((res) => { resolveGetLang = res; }),
    );

    const { result, unmount } = renderHook(() => useI18n(), { wrapper });
    // Unmount before the API promise resolves
    unmount();
    // Resolve after unmount — should NOT cause a state update or React warning
    await act(async () => { resolveGetLang({ preferred_language: "ko" }); });
    // lang is still "en" because the update was cancelled
    expect(result.current.lang).toBe("en");
  });
});
