/**
 * Shared helpers for e2e tests.
 *
 * Key design choices:
 *  - `mockApi` sets up route interceptions for the whole backend API surface
 *    so individual tests can override only the endpoints they care about.
 *  - `getAuthToken` reads the Clerk session token from window.Clerk so tests
 *    can call the real backend API for setup/teardown without a separate
 *    service account.
 *  - `makeSession` / `deleteSession` perform real API calls to create and
 *    clean up test data.
 */

import { type Page, type APIRequestContext } from "@playwright/test";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Shared model factories ────────────────────────────────────────────────

export function fakeSession(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "e2e-session-1",
    title: "E2E Test Session",
    summary: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function fakeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "e2e-msg-1",
    session_id: "e2e-session-1",
    role: "assistant",
    content: "Hello! I am here to help.",
    media_urls: null,
    crisis_flagged: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Auth token helper ─────────────────────────────────────────────────────

/**
 * Returns the current Clerk session JWT from the already-authenticated page.
 * Requires navigating to a page that loads Clerk first.
 */
export async function getAuthToken(page: Page): Promise<string> {
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  const token = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).Clerk?.session?.getToken() as Promise<string>;
  });
  if (!token) throw new Error("Could not obtain Clerk auth token from page");
  return token;
}

// ── Real-API CRUD helpers ─────────────────────────────────────────────────

/**
 * Create a session via the real backend API. Returns the created session object.
 * Useful in `beforeEach` to ensure a known session exists before the test runs.
 */
export async function createSession(
  request: APIRequestContext,
  token: string,
  title = `E2E ${Date.now()}`,
) {
  const res = await request.post(`${API_URL}/api/v1/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  });
  if (!res.ok()) throw new Error(`createSession failed: ${res.status()}`);
  return res.json();
}

/**
 * Delete a session via the real backend API. Silently ignores 404.
 */
export async function deleteSession(
  request: APIRequestContext,
  token: string,
  sessionId: string,
) {
  await request.delete(`${API_URL}/api/v1/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── API mock helpers ──────────────────────────────────────────────────────

/**
 * Install a route mock that returns a controlled JSON response for a given
 * URL glob. Any previous mock for the same pattern is replaced (LIFO order).
 */
export async function mockGet(
  page: Page,
  urlGlob: string,
  body: unknown,
  status = 200,
) {
  await page.route(urlGlob, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    } else {
      await route.continue();
    }
  });
}

export async function mockPost(
  page: Page,
  urlGlob: string,
  body: unknown,
  status = 200,
  contentType = "application/json",
) {
  await page.route(urlGlob, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status,
        contentType,
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Intercept the chat stream endpoint and return a plain-text body that the
 * hook's ReadableStream reader will receive as a single chunk.
 */
export async function mockChatStream(
  page: Page,
  sessionId: string,
  responseText: string,
) {
  await page.route(
    `${API_URL}/api/v1/sessions/${sessionId}/messages`,
    async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: responseText,
        });
      } else {
        await route.continue();
      }
    },
  );
}
