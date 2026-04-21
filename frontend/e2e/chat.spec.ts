/**
 * Chat flow e2e tests.
 *
 * These tests mock the sessions and messages API endpoints so they run
 * without specific data in the backend database. The session ID used in all
 * mocks is "e2e-sess-chat".
 */

import { test, expect } from "./fixtures";
import { API_URL, fakeSession, fakeMessage, mockChatStream } from "./helpers";

const SESSION_ID = "e2e-sess-chat";
const session = fakeSession({ id: SESSION_ID, title: "Chat E2E Session" });

// ── Install mocks before each test ────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Sessions list → one session
  await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([session]),
      });
    } else if (route.request().method() === "POST") {
      // createSession called by the hook after loading
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(session),
      });
    } else {
      await route.continue();
    }
  });

  // Messages list → initially empty
  await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    } else {
      await route.continue();
    }
  });

  // User sync (called by the dashboard layout on load)
  await page.route(`${API_URL}/api/v1/users/sync`, async (route) => {
    await route.fulfill({ status: 200, body: "{}" });
  });

  await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "u1",
        subscription_tier: "free",
        email: "test@example.com",
        full_name: "Test User",
      }),
    });
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Chat flow", () => {
  test("navigates to /chat and shows the session in the sidebar", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText("Chat E2E Session").first()).toBeVisible({ timeout: 8_000 });
  });

  test("shows the empty-state welcome prompt when no messages exist", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText(/how are you doing today/i)).toBeVisible();
  });

  test("sends a message and displays the user bubble", async ({ page }) => {
    await mockChatStream(page, SESSION_ID, "Great, let's talk about that.");

    await page.goto(`/chat/${SESSION_ID}`);

    const textarea = page.getByPlaceholder(/share what's on your mind/i);
    await textarea.fill("I have been feeling anxious");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText("I have been feeling anxious")).toBeVisible();
  });

  test("displays the AI response text after the stream ends", async ({ page }) => {
    const aiReply = "I hear you — anxiety can feel overwhelming.";
    await mockChatStream(page, SESSION_ID, aiReply);

    // After streaming ends, loadMessages is called; return the full exchange
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            fakeMessage({ role: "user", content: "I have been feeling anxious" }),
            fakeMessage({ content: aiReply }),
          ]),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill("I have been feeling anxious");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText(aiReply)).toBeVisible({ timeout: 10_000 });
  });

  test("shows ThinkingIndicator while stream is in progress", async ({ page }) => {
    // Stall the stream with a slow response so we can observe the indicator
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 1_500));
        await route.fulfill({ status: 200, contentType: "text/plain", body: "Done." });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill("test");
    await page.getByRole("button", { name: /send/i }).click();

    // The thinking indicator (bouncing dots + "Thinking…" text) should appear
    await expect(page.getByText(/thinking…/i)).toBeVisible({ timeout: 3_000 });
  });

  test("Send button becomes Stop button while streaming", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 2_000));
        await route.fulfill({ status: 200, contentType: "text/plain", body: "Done." });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill("test");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByRole("button", { name: /stop generation/i })).toBeVisible({
      timeout: 3_000,
    });
  });

  test("Stop button aborts generation and restores the Send button", async ({ page }) => {
    // Use a long delay to give Playwright time to click Stop
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 5_000));
        await route.fulfill({ status: 200, contentType: "text/plain", body: "Never sent." });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill("test");
    await page.getByRole("button", { name: /send/i }).click();

    const stopBtn = page.getByRole("button", { name: /stop generation/i });
    await stopBtn.waitFor({ timeout: 3_000 });
    await stopBtn.click();

    // After abort, the Send button should come back
    await expect(page.getByRole("button", { name: /send/i })).toBeVisible({ timeout: 5_000 });
  });

  test("starter prompts send a message when clicked", async ({ page }) => {
    const promptText = "I've been feeling overwhelmed lately…";
    await mockChatStream(page, SESSION_ID, "I understand.");

    await page.goto(`/chat/${SESSION_ID}`);

    // Click the starter prompt button
    await page.getByRole("button", { name: promptText }).click();

    // The user message should appear in the chat
    await expect(page.getByText(promptText)).toBeVisible({ timeout: 5_000 });
  });

  test("Enter key sends the message; Shift+Enter inserts a newline", async ({ page }) => {
    await mockChatStream(page, SESSION_ID, "OK.");

    await page.goto(`/chat/${SESSION_ID}`);

    const textarea = page.getByPlaceholder(/share what's on your mind/i);

    // Shift+Enter should NOT send (message bubble should not appear)
    await textarea.fill("line one");
    await textarea.press("Shift+Enter");
    // The text "line one" appears in the textarea (visible) but NOT as a chat bubble
    await expect(page.locator(".message-bubble, [data-role='user']").filter({ hasText: "line one" })).not.toBeVisible();

    // Enter without Shift SHOULD send
    await textarea.fill("send this");
    await textarea.press("Enter");
    await expect(page.getByText("send this")).toBeVisible();
  });
});
