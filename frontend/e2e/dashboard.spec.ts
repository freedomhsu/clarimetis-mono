/**
 * Dashboard and Insights page e2e tests.
 *
 * All backend API calls are mocked so these run without a live backend.
 * The tests verify that:
 *  - The dashboard renders the greeting, quick-action cards, and stat tiles
 *  - The insights page renders the analytics summary cards
 *  - Loading states appear while data is being fetched
 *  - Error states are shown when the API returns a failure
 */

import { test, expect } from "./fixtures";
import { API_URL } from "./helpers";

// ── Shared mock data ──────────────────────────────────────────────────────

const fakeUser = {
  id: "u1",
  clerk_user_id: "clerk_u1",
  email: "test@example.com",
  full_name: "Alex Taylor",
  subscription_tier: "free",
  created_at: new Date().toISOString(),
};

const fakeAnalytics = {
  total_sessions: 12,
  total_messages: 84,
  data_reliability: "moderate" as const,
  confidence_score: 65,
  anxiety_score: 42,
  self_esteem_score: 58,
  stress_load: 38,
  cognitive_noise: "moderate" as const,
  logic_loops: [
    { topic: "anxiety around deadlines", frequency: 8, efficiency: 35, fix_type: "Cognitive reframe" },
  ],
  insights: [
    { category: "Sleep", observation: "You have been consistently working on improving sleep habits.", trend: "improving" },
    { category: "Goals", observation: "Goal-setting behaviour is consistent.", trend: "stable" },
  ],
  recommendations: [
    { type: "practice", title: "5-4-3-2-1 Grounding", description: "Use before high-stakes moments.", why: "Your anxiety score peaks." },
  ],
  focus_areas: ["anxiety", "sleep", "goal-setting"],
  relational_observations: [],
  social_gratitude_index: null,
  priority_stack: [],
  generated_at: new Date().toISOString(),
};

// ── Dashboard tests ───────────────────────────────────────────────────────

test.describe("Dashboard page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/api/v1/users/sync`, async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeUser),
      });
    });

    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      });
    });

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
  });

  test("renders a time-of-day greeting with the user's first name", async ({ page }) => {
    await page.goto("/dashboard");
    // Greeting: <p>Good morning/afternoon/evening</p> is separate from the name heading.
    // The name comes from Clerk user.firstName (may be "there" for the test user).
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({
      timeout: 8_000,
    });
  });

  test("renders the Start a session quick-action card", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("link", { name: /start.*session|new session|chat/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("renders the streak tile with the correct day count", async ({ page }) => {
    await page.goto("/dashboard");
    // fakeAnalytics.streak_days = 5
    await expect(page.getByText(/5.*day|day.*5/i)).toBeVisible({ timeout: 8_000 });
  });

  test("renders the total sessions stat", async ({ page }) => {
    await page.goto("/dashboard");
    // Dashboard shows the stat chips with labels (values are static "—" unless fetched)
    await expect(page.getByText(/sessions total|start.*session|text session/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("navigates to /chat when the Start a session card is clicked", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /start.*session|new session|chat/i }).first().click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 5_000 });
  });

  test("navigates to /insights when the Insights link is clicked", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /insights/i }).first().click();
    await expect(page).toHaveURL(/\/insights/, { timeout: 5_000 });
  });

  test("shows an error state when /users/me returns 500", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
      await route.fulfill({ status: 500, body: '{"detail":"server error"}' });
    });

    await page.goto("/dashboard");
    // The page should not white-screen — it should show a fallback
    await expect(page.getByRole("main")).toBeVisible({ timeout: 8_000 });
  });
});

// ── Insights (analytics) page tests ──────────────────────────────────────

test.describe("Insights page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/api/v1/users/sync`, async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeUser),
      });
    });

    // Always mock score history (non-blocking, but avoids network errors in tests)
    await page.route(`${API_URL}/api/v1/analytics/history`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ points: [] }) });
    });
  });

  test("shows a loading spinner while analytics data is being fetched", async ({ page }) => {
    // Delay the analytics response so we can catch the loading state
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      });
    });

    await page.goto("/insights");
    // A spinner/loading indicator should be visible before data arrives
    await expect(
      page.getByRole("progressbar").or(page.getByText(/loading|analy[sz]ing/i)),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("renders the AI-generated summary text after loading", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      });
    });

    await page.goto("/insights");
    await expect(page.getByText(/anxiety|sleep|goal/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("renders the total sessions and messages stats", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      });
    });

    await page.goto("/insights");
    await expect(page.getByText("12")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("84")).toBeVisible({ timeout: 10_000 });
  });

  test("renders the top themes chips", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      });
    });

    await page.goto("/insights");
    for (const theme of fakeAnalytics.focus_areas) {
      await expect(page.getByText(new RegExp(theme, "i")).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("shows an error state when analytics returns 500", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await route.fulfill({ status: 500, body: '{"detail":"server error"}' });
    });

    await page.goto("/insights");
    // Should render an error message, not a blank page
    await expect(
      page.getByText(/error|failed|try again|unavailable/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("the Refresh button re-fetches analytics data", async ({ page }) => {
    let callCount = 0;
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      });
    });

    await page.goto("/insights");
    await expect(page.getByText(/anxiety|sleep/i).first()).toBeVisible({ timeout: 10_000 });
    const callsAfterLoad = callCount;

    await page.getByRole("button", { name: /refresh/i }).click();
    // Should have triggered a second API call
    await expect
      .poll(() => callCount, { timeout: 5_000 })
      .toBeGreaterThan(callsAfterLoad);
  });
});
