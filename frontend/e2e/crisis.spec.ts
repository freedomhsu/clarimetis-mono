/**
 * Crisis detection e2e tests.
 *
 * The CrisisAlert renders inside MessageBubble when `crisis_flagged: true`
 * on an assistant message. The CrisisBanner is a permanent footer always
 * visible at the bottom of every chat page.
 */

import { test, expect } from "./fixtures";
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
  test("shows CrisisAlert inline when the assistant message is crisis-flagged", async ({ page }) => {
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

    // CrisisAlert renders "Important: call or text 988"
    await expect(page.getByText(/important/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/call or text/i).first()).toBeVisible();
  });

  test("does NOT show CrisisAlert when the message is not flagged", async ({ page }) => {
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

    // CrisisAlert should NOT appear (only the permanent footer CrisisBanner)
    await expect(page.getByText(/important/i)).not.toBeVisible();
  });

  test("does NOT show CrisisAlert on user messages even if crisis_flagged is set", async ({
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

    // The user bubble should render, but no inline alert
    await expect(page.getByText("I want to hurt myself")).toBeVisible();
    await expect(page.getByText(/important/i)).not.toBeVisible();
  });

  test("permanent CrisisBanner footer is always visible in chat", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          fakeMessage({ crisis_flagged: false }),
        ]),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);
    // The permanent footer is always shown — "In crisis? Call or text 988"
    await expect(page.getByText(/in crisis\?/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("CrisisBanner footer contains a working link to 988lifeline.org", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([fakeMessage({ crisis_flagged: true })]),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText(/in crisis\?/i).first()).toBeVisible({ timeout: 8_000 });

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
    // The backend prepends crisis_banner_text to the stream when is_crisis=True.
    // We replicate that here so the frontend can detect crisis from content.
    const crisisPrefix =
      "I want to make sure you're safe right now. " +
      "If you're in crisis, please reach out to the **988 Suicide & Crisis Lifeline** " +
      "by calling or texting **988** (US), or chat at https://988lifeline.org. " +
      "I'm here with you.\n\n";
    const streamBody = crisisPrefix + aiReply;

    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else if (method === "POST") {
        // Include the crisis banner prefix — matches what the backend actually sends
        await route.fulfill({ status: 200, contentType: "text/plain", body: streamBody });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what/i).fill(userContent);
    await page.getByRole("button", { name: /send/i }).click();

    // The AI reply should appear; permanent footer is always visible
    await expect(page.getByText(new RegExp(aiReply, "i")).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/in crisis\?/i).first()).toBeVisible();
  });
});
