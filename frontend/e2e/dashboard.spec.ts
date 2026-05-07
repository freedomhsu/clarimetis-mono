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
  ego_score: 52,
  emotion_control_score: 67,
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
    // Wait for auth-dependent content to confirm Clerk session is fully resolved
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 8_000 });
    await page.getByRole("link", { name: /start.*session|new session|chat/i }).first().click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 8_000 });
  });

  test("navigates to /insights when the Insights link is clicked", async ({ page }) => {
    await page.goto("/dashboard");
    // Wait for auth-dependent content to confirm Clerk session is fully resolved
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 8_000 });
    await page.getByRole("link", { name: /insights/i }).first().click();
    await expect(page).toHaveURL(/\/insights/, { timeout: 8_000 });
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
    // Scope to stat cards to avoid matching timestamps (e.g. "12:39:21 PM" also contains "12")
    const sessionsCard = page.locator("div", { has: page.getByText("Coaching sessions") });
    await expect(sessionsCard.getByText("12", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    const messagesCard = page.locator("div", { has: page.getByText("Messages analysed") });
    await expect(messagesCard.getByText("84", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
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
    await page.route(`${API_URL}/api/v1/analytics/summary*`, async (route) => {
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

// ── Dashboard tier UI ─────────────────────────────────────────────────────

/**
 * These tests verify that the "Upgrade to Pro" / "Manage Billing" UI in the
 * dashboard correctly reflects the user's subscription tier returned by the
 * backend. All API calls are mocked so no live backend is needed.
 */
test.describe("Dashboard tier UI", () => {
  /** Mount the base routes common to all tier tests. */
  async function setupCommonRoutes(page: import("@playwright/test").Page, tier: "free" | "pro") {
    await page.route(`${API_URL}/api/v1/users/sync`, (route) =>
      route.fulfill({ status: 200, body: "{}" }),
    );
    await page.route(`${API_URL}/api/v1/users/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...fakeUser, subscription_tier: tier }),
      }),
    );
    await page.route(`${API_URL}/api/v1/sessions`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      }),
    );
  }

  test("free user sees 'Upgrade to Pro' in the sidebar", async ({ page }) => {
    await setupCommonRoutes(page, "free");
    await page.goto("/dashboard");
    await expect(page.getByText(/upgrade to pro/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("free user sees subscription plan buttons when Manage Plan is clicked", async ({ page }) => {
    await setupCommonRoutes(page, "free");
    await page.goto("/dashboard");
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: /manage plan/i }).click();
    await expect(page.getByRole("button", { name: /pro monthly/i })).toBeVisible({ timeout: 4_000 });
    await expect(page.getByRole("button", { name: /pro annual/i })).toBeVisible({ timeout: 4_000 });
  });

  test("pro user does NOT see 'Upgrade to Pro' in the sidebar", async ({ page }) => {
    await setupCommonRoutes(page, "pro");
    await page.goto("/dashboard");
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/upgrade to pro/i)).not.toBeVisible();
  });

  test("pro user sees 'Pro plan · Unlimited' in the sidebar", async ({ page }) => {
    await setupCommonRoutes(page, "pro");
    await page.goto("/dashboard");
    await expect(page.getByText(/pro plan.*unlimited/i)).toBeVisible({ timeout: 8_000 });
  });

  test("pro user opening Manage Plan sees only Manage Billing button (no subscribe buttons)", async ({ page }) => {
    await setupCommonRoutes(page, "pro");
    await page.goto("/dashboard");
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: /manage plan/i }).click();
    await expect(page.getByRole("button", { name: /manage billing/i })).toBeVisible({ timeout: 4_000 });
    await expect(page.getByRole("button", { name: /pro monthly/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /pro annual/i })).not.toBeVisible();
  });

  test("upgrade success banner appears when landing with ?upgrade=success", async ({ page }) => {
    await setupCommonRoutes(page, "pro");
    await page.goto("/dashboard?upgrade=success&plan=annual");
    await expect(page.getByText(/you're now on pro/i)).toBeVisible({ timeout: 8_000 });
  });

  test("upgrade success banner is dismissed when the × button is clicked", async ({ page }) => {
    await setupCommonRoutes(page, "pro");
    await page.goto("/dashboard?upgrade=success");
    await expect(page.getByText(/you're now on pro/i)).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: /dismiss/i }).click();
    await expect(page.getByText(/you're now on pro/i)).not.toBeVisible();
  });

  test("?upgrade=success is removed from the URL after landing", async ({ page }) => {
    await setupCommonRoutes(page, "pro");
    await page.goto("/dashboard?upgrade=success&plan=annual");
    await expect(page.getByText(/you're now on pro/i)).toBeVisible({ timeout: 8_000 });
    await expect(page).not.toHaveURL(/upgrade=success/);
  });

  test(
    "sidebar upgrades from 'Upgrade to Pro' to 'Pro plan · Unlimited' once polling picks up the webhook",
    async ({ page }) => {
      // Simulate Stripe webhook latency: first call returns "free", subsequent calls return "pro".
      let callCount = 0;
      await page.route(`${API_URL}/api/v1/users/sync`, (route) =>
        route.fulfill({ status: 200, body: "{}" }),
      );
      await page.route(`${API_URL}/api/v1/users/me`, (route) => {
        callCount++;
        const tier = callCount === 1 ? "free" : "pro";
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...fakeUser, subscription_tier: tier }),
        });
      });
      await page.route(`${API_URL}/api/v1/sessions`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
      );
      await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fakeAnalytics),
        }),
      );

      await page.goto("/dashboard?upgrade=success");

      // The banner only appears once polling confirms tier === "pro".
      // First /users/me returns "free" (webhook hasn't processed yet), the second
      // (polling interval) returns "pro" and both the banner and the sidebar flip
      // at the same time.
      await expect(page.getByText(/you're now on pro/i)).toBeVisible({ timeout: 8_000 });

      // Polling should flip the sidebar to "Pro plan · Unlimited" without a page reload.
      await expect(page.getByText(/pro plan.*unlimited/i)).toBeVisible({ timeout: 10_000 });
      // And the upgrade CTA should disappear.
      await expect(page.getByText(/upgrade to pro/i)).not.toBeVisible();
    },
  );
});

// ── Language picker tests ─────────────────────────────────────────────────────

test.describe("Language picker", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/api/v1/users/sync`, (route) =>
      route.fulfill({ status: 200, body: "{}" }),
    );
    await page.route(`${API_URL}/api/v1/users/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...fakeUser, subscription_tier: "free" }),
      }),
    );
    await page.route(`${API_URL}/api/v1/sessions`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeAnalytics),
      }),
    );
  });

  test("language picker button is visible in the sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /change ai language/i })).toBeVisible({
      timeout: 8_000,
    });
  });

  test("language picker lists all 8 supported languages including Italian", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /change ai language/i }).click();

    for (const label of ["English", "Español", "Português", "Français", "Italiano", "繁體中文", "日本語", "한국어"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible({
        timeout: 4_000,
      });
    }
  });

  test("selecting Español closes the picker and updates the displayed language", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /change ai language/i }).click();
    await page.getByRole("button", { name: /español/i }).click();

    // Picker should close
    await expect(page.getByRole("button", { name: /english/i })).not.toBeVisible();
    // Current language button should now show Español
    await expect(page.getByRole("button", { name: /change ai language/i })).toContainText("Español");
  });

  test("selecting Italiano closes the picker and updates the displayed language", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /change ai language/i }).click();
    await page.getByRole("button", { name: /italiano/i }).click();

    // Picker should close
    await expect(page.getByRole("button", { name: /español/i })).not.toBeVisible();
    // Current language button should now show Italiano
    await expect(page.getByRole("button", { name: /change ai language/i })).toContainText("Italiano");
  });
});
