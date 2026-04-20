/**
 * Crisis detection e2e tests.
 *
 * The CrisisBanner renders inside MessageBubble when `crisis_flagged: true`
 * on an assistant message. These tests mock the messages GET endpoint to
 * return a crisis-flagged message so we can verify the banner appears
 * without triggering real crisis detection in the backend.
 */

import { test, expect } from "@playwright/test";
import { API_URL, fakeSession, fakeMessage } from "./helpers";

const SESSION_ID = "e2e-sess-crisis";
const session = fakeSession({ id: SESSION_ID, title: "Crisis E2E" });

test.beforeEach(async ({ page }) => {
  // Sessions list
  await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([session]),
      });
    } else {
      await route.continue();
    }
  });

  // User sync / me
  await page.route(`${API_URL}/api/v1/users/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "u1", subscription_tier: "free", email: "t@t.com", full_name: "T" }),
    });
  });
});

test.describe("Crisis banner", () => {
  test("shows CrisisBanner when the assistant message is crisis-flagged", async ({ page }) => {
    // Populate the chat with a crisis-flagged assistant message
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          fakeMessage({
            role: "assistant",
            content: "It sounds like you might be going through a really hard time.",
            crisis_flagged: true,
          }),
        ]),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);

    // The CrisisBanner renders the 988 hotline text
    await expect(page.getByText(/988 suicide.*crisis lifeline/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/if you're in crisis/i)).toBeVisible();
  });

  test("does NOT show CrisisBanner when the message is not flagged", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          fakeMessage({ role: "assistant", content: "Great, let's set a goal.", crisis_flagged: false }),
        ]),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);

    await expect(page.getByText(/988 suicide.*crisis lifeline/i)).not.toBeVisible();
  });

  test("does NOT show CrisisBanner on user messages even if crisis_flagged is set", async ({
    page,
  }) => {
    // The backend only sets crisis_flagged on assistant messages, but guard
    // against accidental client-side rendering.
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          fakeMessage({ role: "user", content: "I want to hurt myself", crisis_flagged: true }),
        ]),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);

    // The user bubble should render, but no banner (MessageBubble only renders
    // CrisisBanner for role === "assistant")
    await expect(page.getByText("I want to hurt myself")).toBeVisible();
    await expect(page.getByText(/988 suicide.*crisis lifeline/i)).not.toBeVisible();
  });

  test("CrisisBanner can be dismissed with the × button", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          fakeMessage({ crisis_flagged: true }),
        ]),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText(/988 suicide.*crisis lifeline/i)).toBeVisible({ timeout: 8_000 });

    await page.getByRole("button", { name: /dismiss/i }).click();

    await expect(page.getByText(/988 suicide.*crisis lifeline/i)).not.toBeVisible();
  });

  test("CrisisBanner contains a working link to 988lifeline.org", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([fakeMessage({ crisis_flagged: true })]),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText(/988 suicide.*crisis lifeline/i)).toBeVisible({ timeout: 8_000 });

    const link = page.getByRole("link", { name: /988lifeline\.org/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://988lifeline.org");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("crisis banner appears after sending a message that triggers flagging", async ({
    page,
  }) => {
    const userContent = "I don't want to be here anymore";
    const aiReply = "I can hear how much pain you are in right now.";

    // Step 1: initially no messages
    let callCount = 0;
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        callCount++;
        if (callCount === 1) {
          // First load: no messages
          await route.fulfill({ status: 200, body: "[]" });
        } else {
          // Subsequent loads (after send): return crisis-flagged exchange
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
              fakeMessage({ role: "user", content: userContent, crisis_flagged: false }),
              fakeMessage({ content: aiReply, crisis_flagged: true }),
            ]),
          });
        }
      } else if (method === "POST") {
        // Streaming response — return plain text
        await route.fulfill({ status: 200, contentType: "text/plain", body: aiReply });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what's on your mind/i).fill(userContent);
    await page.getByRole("button", { name: /send/i }).click();

    // Banner should appear after the server confirms crisis_flagged
    await expect(page.getByText(/988 suicide.*crisis lifeline/i)).toBeVisible({ timeout: 10_000 });
  });
});
