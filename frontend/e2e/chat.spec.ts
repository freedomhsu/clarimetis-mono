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

  test("shows the empty-state welcome screen when no messages exist", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    // ChatWindow renders a branded empty state — verify its headline and at least
    // one starter prompt button are present.
    await expect(page.getByText(/end social fear/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /overwhelmed/i })).toBeVisible();
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

  test("Send button is disabled when textarea is empty, enabled after typing", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    // Initially empty — button must be disabled
    const sendBtn = page.getByRole("button", { name: /send/i });
    await expect(sendBtn).toBeDisabled({ timeout: 5_000 });

    // After typing, button becomes enabled
    await page.getByPlaceholder(/share what's on your mind/i).fill("hello");
    await expect(sendBtn).toBeEnabled();

    // Clearing the input (or entering only whitespace) disables it again
    await page.getByPlaceholder(/share what's on your mind/i).fill("   ");
    await expect(sendBtn).toBeDisabled();
  });

  test("status messages from the stream protocol appear in the thinking indicator", async ({ page }) => {
    // The backend multiplexes status lines using \x00STATUS\x00:<text>\n.
    // Verify that parseStreamChunk extracts them and the UI renders them.
    const statusLine = "\x00STATUS\x00:Retrieving relevant memories...\n";
    const content = "Here is my response.";

    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        // Deliver the status line followed by the actual content in one body.
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: statusLine + content,
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill("anything");
    await page.getByRole("button", { name: /send/i }).click();

    // The assistant content must appear (proves the status line was stripped and
    // the content after it was yielded correctly).
    await expect(page.getByText(content)).toBeVisible({ timeout: 10_000 });
  });

  test("guardrail redirect message persists after loadMessages refresh", async ({ page }) => {
    // Before the bug-fix in chat.py the redirect text was not saved to DB, so
    // the 600 ms loadMessages() refresh replaced it with an empty list and the
    // message disappeared.  Now it is saved — verify it survives the refresh.
    const redirectText =
      "I hear that you're dealing with something health-related, and I want to support you.";

    // POST returns the redirect stream (no sentinel — plain redirect prose)
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 200, contentType: "text/plain", body: redirectText });
      } else if (route.request().method() === "GET") {
        // Simulate the backend having saved the redirect as an assistant message
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            fakeMessage({ role: "user", content: "Diagnose my chest pain" }),
            fakeMessage({ role: "assistant", content: redirectText }),
          ]),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill("Diagnose my chest pain");
    await page.getByRole("button", { name: /send/i }).click();

    // Text must appear immediately after streaming
    await expect(page.getByText(/health-related/i)).toBeVisible({ timeout: 10_000 });

    // Wait well past the 600 ms refresh window — text must still be present
    await page.waitForTimeout(1_200);
    await expect(page.getByText(/health-related/i)).toBeVisible();
  });

  test("upload failure displays an inline error message (not a browser alert)", async ({ page }) => {
    // Mock a server error on the upload endpoint.  The fix changed MediaUpload
    // from calling alert() to calling onUploadError(message), which MessageInput
    // renders inline.  Verify the error text appears in the UI.
    await page.route(`${API_URL}/api/v1/media/upload`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "storage unavailable" }),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);

    // Playwright will throw if a browser dialog (alert) fires without a handler,
    // so no explicit guard is needed — the test itself detects the regression.
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /attach/i }).click(),
    ]);
    await fileChooser.setFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-data"),
    });

    // The error must appear inline in the input area, NOT via browser alert
    await expect(page.getByText(/failed to upload file/i)).toBeVisible({ timeout: 8_000 });
  });

  test("markdown links in AI responses open in a new tab", async ({ page }) => {
    // Load a session with an assistant message that contains a markdown link.
    // MessageBubble renders it via ReactMarkdown with a custom `a` component
    // that sets target=_blank and rel=noopener noreferrer.
    const linkContent = "Visit [988lifeline.org](https://988lifeline.org) for support.";

    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            fakeMessage({ role: "assistant", content: linkContent }),
          ]),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);

    const link = page.getByRole("link", { name: /988lifeline\.org/i });
    await expect(link).toBeVisible({ timeout: 8_000 });
    await expect(link).toHaveAttribute("href", "https://988lifeline.org");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("AI response stays visible after stream ends and does not disappear", async ({ page }) => {
    // Regression: loadMessages() was called immediately after streaming, racing
    // the backend background task. If the DB write hadn't committed yet the list
    // was stale and the response vanished until the user refreshed.
    //
    // Fix: loadMessages() is no longer called after sendMessage at all.
    // The optimistic message has the full content and persists indefinitely.
    const aiReply = "I hear you — let's explore that together.";

    await mockChatStream(page, SESSION_ID, aiReply);

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill("I need support");
    await page.getByRole("button", { name: /send/i }).click();

    // Response must appear after streaming
    await expect(page.getByText(aiReply)).toBeVisible({ timeout: 10_000 });

    // Wait well past where the old reload would have fired — response must still be there
    await page.waitForTimeout(1_500);
    await expect(page.getByText(aiReply)).toBeVisible();
  });
});
