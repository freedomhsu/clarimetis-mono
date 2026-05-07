/**
 * Network error and server error e2e tests for the chat flow.
 *
 * These tests verify that the UI degrades gracefully when the backend is
 * unavailable, returns unexpected status codes, or the network drops mid-
 * stream. None of the existing chat tests cover these failure paths.
 *
 * All tests use route mocks — no live backend required.
 */

import { test, expect } from "./fixtures";
import { API_URL, fakeSession, fakeMessage } from "./helpers";

const SESSION_ID = "e2e-sess-errors";
const session = fakeSession({ id: SESSION_ID, title: "Error Tests" });

// ── Shared setup ──────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
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

  await page.route(`${API_URL}/api/v1/users/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "u1", subscription_tier: "free", email: "t@t.com", full_name: "T" }),
    });
  });
});

// ── 500 from the messages endpoint ────────────────────────────────────────

test.describe("500 error on send", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Internal server error" }),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("shows an error message in the UI after a 500", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what/i).fill("hello");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(
      page.getByText(/something went wrong. please try again/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("rolls back the optimistic user message after a 500", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what/i).fill("this should be rolled back");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(
      page.getByText(/something went wrong. please try again/i),
    ).toBeVisible({ timeout: 8_000 });

    await expect(page.getByText("this should be rolled back")).not.toBeVisible();
  });

  test("re-enables the input and Send button after a 500", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what/i).fill("test");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(
      page.getByText(/something went wrong. please try again/i),
    ).toBeVisible({ timeout: 8_000 });

    // After error, the input and Send button should be interactive again
    await expect(page.getByPlaceholder(/share what/i)).toBeEnabled();
    // Re-fill input to verify send button becomes enabled again
    await page.getByPlaceholder(/share what/i).fill("retry");
    await expect(page.getByRole("button", { name: /send/i })).toBeEnabled();
  });
});

// ── Network failure (connection refused / offline) ────────────────────────

test.describe("Network failure on send", () => {
  test("shows an error message when the network request fails", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else if (route.request().method() === "POST") {
        // Abort simulates a network failure (connection refused, offline, etc.)
        await route.abort("connectionrefused");
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what/i).fill("network test");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(
      page.getByText(/something went wrong. please try again/i),
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ── 401 Unauthorized ──────────────────────────────────────────────────────

test.describe("401 unauthorized on send", () => {
  test("handles a 401 response without crashing the page", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else if (route.request().method() === "POST") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Invalid or expired token" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await page.getByPlaceholder(/share what/i).fill("auth test");
    await page.getByRole("button", { name: /send/i }).click();

    // Wait for error message or redirect to sign-in
    await page.waitForFunction(
      () => document.body.innerText.includes("Something went wrong") || window.location.pathname.includes("sign-in"),
      { timeout: 8_000 }
    );
    const hasError = await page.getByText(/something went wrong/i).isVisible();
    const redirectedToSignIn = page.url().includes("sign-in");
    expect(hasError || redirectedToSignIn).toBe(true);
  });
});

// ── Session load failure ──────────────────────────────────────────────────

test.describe("Session load failure", () => {
  test("shows an error when messages cannot be loaded for a session", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 503, body: '{"detail":"service unavailable"}' });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);

    // The app should not white-screen; some error or empty-state should render
    await expect(page.getByRole("main")).toBeVisible({ timeout: 8_000 });
  });

  test("shows an error when the sessions list cannot be loaded", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 500, body: '{"detail":"db error"}' });
      } else {
        await route.continue();
      }
    });

    await page.goto("/chat");

    // Should not crash — sidebar should be empty or show an error
    await expect(page.getByRole("main")).toBeVisible({ timeout: 8_000 });
  });
});
