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

// Glob prefix for page.route() mock patterns — matches any origin, so patterns
// like `${API_URL}/api/v1/sessions` work whether the browser calls the backend
// directly or through the Next.js /api/proxy route handler.
export const API_URL = "**";

// Real backend URL for Playwright APIRequestContext calls (createSession etc.)
// that bypass the browser and hit the backend directly.
const _BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
  // Wait for Clerk to initialize and set a session
  await page.waitForFunction(
    () => window.Clerk?.session != null,
    { timeout: 15_000 }
  );
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
  const res = await request.post(`${_BACKEND_URL}/api/v1/sessions`, {
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
  await request.delete(`${_BACKEND_URL}/api/v1/sessions/${sessionId}`, {
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

// ── Voice API mock helpers ────────────────────────────────────────────────

/**
 * Build a minimal WAV buffer (44-byte header + one silent sample).
 * Used as a fake audio Blob when Playwright intercepts the MediaRecorder —
 * the bytes never reach the real Google STT, so accuracy doesn't matter.
 */
export function silentWavBuffer(): Buffer {
  const buf = Buffer.alloc(46);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(38, 4);            // chunk size
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);           // PCM subchunk size
  buf.writeUInt16LE(1, 20);            // PCM format
  buf.writeUInt16LE(1, 22);            // 1 channel
  buf.writeUInt32LE(16000, 24);        // 16 kHz
  buf.writeUInt32LE(32000, 28);        // byte rate
  buf.writeUInt16LE(2, 32);            // block align
  buf.writeUInt16LE(16, 34);           // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(2, 40);            // data subchunk size
  buf.writeInt16LE(0, 44);             // one silent sample
  return buf;
}

/**
 * Build a fake voice-conversation response as the backend returns it.
 */
export function fakeVoiceConversationResponse(overrides: Partial<{
  user_transcript: string;
  assistant_text: string;
  audio_data: string;
  crisis_flagged: boolean;
}> = {}) {
  // 1-second silent WAV encoded as a data URI
  const wavB64 = silentWavBuffer().toString("base64");
  return {
    user_transcript: "Hello, how are you?",
    assistant_text: "I'm doing well, thank you for asking.",
    audio_data: `data:audio/wav;base64,${wavB64}`,
    crisis_flagged: false,
    ...overrides,
  };
}

/**
 * Stub `navigator.mediaDevices.getUserMedia` to return a silent synthetic
 * MediaStream, and override `MediaRecorder` so `start()` immediately fires
 * `ondataavailable` with a tiny WAV blob and then `onstop`.
 *
 * This avoids real microphone permissions in headless CI while still
 * exercising the hook's full MediaRecorder lifecycle.
 */
export async function stubMediaRecorder(page: Page) {
  await page.addInitScript(() => {
    // Silent oscillator as a fake mic track
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    const fakeStream = dst.stream;

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getUserMedia: () => Promise.resolve(fakeStream),
      },
    });

    // Minimal WAV blob the stub emits as the "recorded" chunk
    const wavBytes = new Uint8Array(46);
    const view = new DataView(wavBytes.buffer);
    // RIFF header
    [82,73,70,70].forEach((b,i) => view.setUint8(i, b));
    view.setUint32(4, 38, true);
    [87,65,86,69].forEach((b,i) => view.setUint8(8+i, b));
    [102,109,116,32].forEach((b,i) => view.setUint8(12+i, b));
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    [100,97,116,97].forEach((b,i) => view.setUint8(36+i, b));
    view.setUint32(40, 2, true);
    const fakeBlob = new Blob([wavBytes], { type: "audio/wav" });

    const OriginalMediaRecorder = window.MediaRecorder;
    // @ts-expect-error — intentional override for test stub
    window.MediaRecorder = class FakeMediaRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      mimeType = "audio/wav";
      state: "inactive" | "recording" = "inactive";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public stream: MediaStream) { super(); }
      start() {
        this.state = "recording";
        // Fire data immediately then stop so the hook processes it right away
        setTimeout(() => {
          const e = new Event("dataavailable") as BlobEvent;
          Object.defineProperty(e, "data", { value: fakeBlob });
          this.ondataavailable?.(e as BlobEvent);
          this.state = "inactive";
          this.onstop?.();
        }, 100);
      }
      stop() {
        if (this.state !== "inactive") {
          this.state = "inactive";
          this.onstop?.();
        }
      }
    };
    // Preserve static properties from the real MediaRecorder
    Object.assign(window.MediaRecorder, OriginalMediaRecorder);
  });
}
