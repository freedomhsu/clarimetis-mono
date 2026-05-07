/**
 * Voice conversation e2e tests.
 *
 * Coverage:
 *  - Page loads and creates a voice session automatically
 *  - Reuses an existing "Voice —" session instead of creating a duplicate
 *  - Mic button starts recording (state: recording, button changes)
 *  - Recording → backend POST → transcript + AI text appear in the turn list
 *  - AI audio plays and the speaking state is shown
 *  - Stop-speaking button (VolumeX) exits the speaking state
 *  - Tap-to-play fallback when browser autoplay is blocked
 *  - Second recording appends a new turn pair
 *  - 422 "too short or silent" surfaces the backend message (not a generic one)
 *  - 413 "too large" surfaces the backend message
 *  - 402 subscription_required surfaces the upgrade error banner
 *  - Crisis-flagged response shows the CrisisBanner
 *  - Dismiss button on error banner clears the error
 *  - Session-creation failure shows the "Failed to start voice session" screen
 *
 * All tests mock the backend — no live service required.
 * The MediaRecorder is stubbed via stubMediaRecorder() in helpers.ts so no
 * real microphone permission is needed in CI.
 */

import { test, expect } from "./fixtures";
import {
  API_URL,
  fakeSession,
  fakeVoiceConversationResponse,
  stubMediaRecorder,
} from "./helpers";

const SESSION_ID = "e2e-voice-sess";
const voiceSession = fakeSession({
  id: SESSION_ID,
  title: `Voice — ${new Date().toLocaleDateString()}`,
});

// ── Shared setup ──────────────────────────────────────────────────────────

/** Install all mocks that every voice test needs. */
async function setupCommonMocks(page: import("@playwright/test").Page) {
  await page.route(`${API_URL}/api/v1/users/sync`, async (route) => {
    await route.fulfill({ status: 200, body: "{}" });
  });
  await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "u1",
        subscription_tier: "pro",
        email: "test@example.com",
        full_name: "Test User",
      }),
    });
  });
}

// ── Session lifecycle ─────────────────────────────────────────────────────

test.describe("Voice session lifecycle", () => {
  test("creates a new voice session when none exists and shows the idle UI", async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(voiceSession),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/voice");
    await expect(page.getByRole("heading", { name: /voice session/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/tap the microphone/i)).toBeVisible();
    // Mic button is present and enabled (session is loaded)
    await expect(page.getByRole("button", { name: /start speaking/i })).toBeEnabled();
  });

  test("reuses an existing Voice — session instead of creating a new one", async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    let createCalled = false;
    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([voiceSession]),
        });
      } else if (route.request().method() === "POST") {
        createCalled = true;
        await route.continue();
      } else {
        await route.continue();
      }
    });

    await page.goto("/voice");
    await expect(page.getByText(voiceSession.title)).toBeVisible({ timeout: 8_000 });
    expect(createCalled).toBe(false);
  });

  test("shows the error screen when session creation fails", async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else {
        await route.fulfill({ status: 500, body: '{"detail":"db error"}' });
      }
    });

    await page.goto("/voice");
    await expect(page.getByText(/failed to start voice session/i)).toBeVisible({ timeout: 8_000 });
  });
});

// ── Happy-path conversation flow ──────────────────────────────────────────

test.describe("Happy-path conversation", () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([voiceSession]),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("pressing the mic button transitions to the recording state", async ({ page }) => {
    // Never resolve the API call so we stay in the recording state long enough to assert
    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async () => {
      // Intentionally hang — the stub MediaRecorder fires onstop after ~100 ms
      // so we get a brief window in the recording state before thinking starts.
      // We check the recording state right after clicking, before the stub stops.
      await new Promise(() => { /* hang */ });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();
    // The waveform bars (animated recording indicator) are visible
    await expect(page.getByRole("button", { name: /stop recording/i })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/recording/i)).toBeVisible();
  });

  test("completed recording shows transcript and AI reply turns", async ({ page }) => {
    const response = fakeVoiceConversationResponse({
      user_transcript: "I feel anxious about presentations",
      assistant_text: "That's a very common feeling. Let's work through it together.",
    });

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    // Both turns appear in the transcript
    await expect(page.getByText("I feel anxious about presentations")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("That's a very common feeling.")).toBeVisible({ timeout: 8_000 });
  });

  test("shows 'AI is speaking' label and stop button while audio plays", async ({ page }) => {
    const response = fakeVoiceConversationResponse();

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });

    // Prevent audio from actually ending immediately so the speaking state persists
    await page.addInitScript(() => {
      const orig = window.Audio;
      // @ts-expect-error — stub
      window.Audio = class FakeAudio {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() { return Promise.resolve(); }   // resolves immediately (no NotAllowedError)
        pause() {}
        // Never fire onended so the speaking state stays
      };
      window.Audio = window.Audio ?? orig;
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(page.getByText(/ai is speaking/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /stop ai speaking/i })).toBeVisible();
  });

  test("stop-speaking button returns to idle state", async ({ page }) => {
    const response = fakeVoiceConversationResponse();

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });

    await page.addInitScript(() => {
      // @ts-expect-error — stub
      window.Audio = class FakeAudio {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() { return Promise.resolve(); }
        pause() {}
      };
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();
    await page.getByRole("button", { name: /stop ai speaking/i }).click({ timeout: 8_000 });

    // After stopping, we should be back in the idle state with the mic button
    await expect(page.getByRole("button", { name: /start speaking/i })).toBeVisible({ timeout: 4_000 });
  });

  test("second recording appends a second pair of turns", async ({ page }) => {
    let callCount = 0;
    const responses = [
      fakeVoiceConversationResponse({ user_transcript: "Turn one", assistant_text: "Reply one" }),
      fakeVoiceConversationResponse({ user_transcript: "Turn two", assistant_text: "Reply two" }),
    ];

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(responses[callCount++ % 2]),
      });
    });

    // Audio ends immediately so the hook returns to idle
    await page.addInitScript(() => {
      // @ts-expect-error — stub
      window.Audio = class FakeAudio {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() {
          setTimeout(() => this.onended?.(), 50);
          return Promise.resolve();
        }
        pause() {}
      };
    });

    await page.goto("/voice");

    // First turn
    await page.getByRole("button", { name: /start speaking/i }).click();
    await expect(page.getByText("Turn one")).toBeVisible({ timeout: 8_000 });

    // Wait for idle, then second turn
    await expect(page.getByRole("button", { name: /start speaking/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /start speaking/i }).click();
    await expect(page.getByText("Turn two")).toBeVisible({ timeout: 8_000 });

    // All four bubbles visible
    await expect(page.getByText("Reply one")).toBeVisible();
    await expect(page.getByText("Reply two")).toBeVisible();
  });
});

// ── Autoplay-blocked fallback ─────────────────────────────────────────────

test.describe("Autoplay blocked", () => {
  test("shows tap-to-play button when browser rejects play()", async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([voiceSession]),
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeVoiceConversationResponse()),
      });
    });

    // Simulate browser autoplay policy rejection
    await page.addInitScript(() => {
      // @ts-expect-error — stub
      window.Audio = class FakeAudio {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() {
          const err = new DOMException("autoplay blocked", "NotAllowedError");
          return Promise.reject(err);
        }
        pause() {}
      };
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(page.getByRole("button", { name: /tap to hear response/i })).toBeVisible({ timeout: 8_000 });
  });
});

// ── Error surfaces ────────────────────────────────────────────────────────

test.describe("Error handling", () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([voiceSession]),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("422 silent audio: shows the backend error message, not generic fallback", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Recording was too short or silent -- please try again.",
        }),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(
      page.getByText(/recording was too short or silent/i)
    ).toBeVisible({ timeout: 8_000 });
    // Must NOT show the generic fallback
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test("413 audio too large: shows the backend error message", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 413,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Audio file exceeds the 10 MB size limit." }),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(page.getByText(/10 mb size limit/i)).toBeVisible({ timeout: 8_000 });
  });

  test("402 subscription_required: shows the subscription error message", async ({ page }) => {
    const subError = {
      detail: {
        code: "subscription_required",
        message: "This feature requires a Pro subscription.",
        upgrade_path: "/dashboard",
      },
    };

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify(subError),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(
      page.getByText(/this feature requires a pro subscription/i)
    ).toBeVisible({ timeout: 8_000 });
  });

  test("500 server error: shows generic error message", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Internal server error" }),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(page.getByText(/something went wrong/i)).toBeVisible({ timeout: 8_000 });
  });

  test("dismiss button clears the error banner and returns the mic button", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Recording was too short or silent -- please try again." }),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();
    await expect(page.getByText(/recording was too short/i)).toBeVisible({ timeout: 8_000 });

    await page.getByRole("button", { name: /dismiss/i }).click();

    // Error is gone and mic button is back
    await expect(page.getByText(/recording was too short/i)).not.toBeVisible();
    await expect(page.getByRole("button", { name: /start speaking/i })).toBeVisible();
  });

  test("microphone permission denied shows an error", async ({ page }) => {
    // Override getUserMedia to reject before the stub fires
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        writable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
        },
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(page.getByText(/microphone access denied/i)).toBeVisible({ timeout: 6_000 });
  });
});

// ── Crisis detection ──────────────────────────────────────────────────────

test.describe("Crisis detection", () => {
  test("shows CrisisBanner when backend returns crisis_flagged: true", async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([voiceSession]),
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          fakeVoiceConversationResponse({
            user_transcript: "I've been having really dark thoughts lately.",
            assistant_text: "I hear you. If you're in crisis, please reach out to the 988 Lifeline.",
            crisis_flagged: true,
          }),
        ),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(page.getByText(/988/i)).toBeVisible({ timeout: 8_000 });
  });

  test("does NOT show CrisisBanner when crisis_flagged is false", async ({ page }) => {
    await setupCommonMocks(page);
    await stubMediaRecorder(page);

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([voiceSession]),
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`${API_URL}/api/v1/voice/conversation/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeVoiceConversationResponse({ crisis_flagged: false })),
      });
    });

    await page.goto("/voice");
    await page.getByRole("button", { name: /start speaking/i }).click();

    await expect(page.getByText(/988 suicide/i)).not.toBeVisible({ timeout: 5_000 });
  });
});
