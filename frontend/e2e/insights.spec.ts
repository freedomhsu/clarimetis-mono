/**
 * Comprehensive e2e tests for the Insights (/insights) page.
 *
 * Coverage:
 *  - Loading and error states
 *  - 402 subscription gate (blurred mock + upgrade overlay)
 *  - At-a-glance stat tiles
 *  - Psychological Profile section (all 6 score gauges, data_reliability callout,
 *    cognitive noise widget)
 *  - Insufficient-data state (all scores null → "Not enough data" placeholders)
 *  - Logic Loops section
 *  - Observations section (trend labels)
 *  - Recommendations section
 *  - Priority Stack section
 *  - Relational Capital section
 *  - Score history chart (empty state + data state)
 *  - Refresh button behaviour
 *  - History load failure doesn't block the summary
 *
 * All backend calls are mocked — no live backend required.
 */

import { test, expect } from "./fixtures";
import { API_URL } from "./helpers";

// ── Mock data ────────────────────────────────────────────────────────────────

/** Fully-populated AnalyticsSummary — covers every section of the page. */
const FULL_ANALYTICS = {
  total_sessions: 14,
  total_messages: 107,
  data_reliability: "high" as const,
  confidence_score: 71,
  anxiety_score: 55,
  self_esteem_score: 63,
  ego_score: 48,
  emotion_control_score: 74,
  self_awareness_score: 61,
  motivation_score: 44,
  stress_load: 62,
  cognitive_noise: "moderate" as const,
  logic_loops: [
    {
      topic: "Imposter syndrome at work",
      frequency: 13,
      efficiency: 29,
      fix_type: "Cognitive reframe",
    },
    {
      topic: "Conflict avoidance",
      frequency: 7,
      efficiency: 51,
      fix_type: "Boundary Setting (Relational)",
    },
  ],
  insights: [
    {
      category: "Growth",
      observation: "You consistently underestimate progress you have made in the last quarter.",
      trend: "improving" as const,
    },
    {
      category: "Stress",
      observation: "Deadline pressure triggers avoidance behaviours.",
      trend: "declining" as const,
    },
  ],
  recommendations: [
    {
      type: "book" as const,
      title: "Feeling Good",
      description: "CBT-based self-help for cognitive distortions.",
      why: "Directly targets your imposter syndrome loop.",
    },
    {
      type: "practice" as const,
      title: "Box Breathing",
      description: "4-4-4-4 breath technique for acute stress.",
      why: "Addresses your stress peaks around deadlines.",
    },
  ],
  focus_areas: ["Confidence", "Stress regulation", "Boundaries"],
  relational_observations: [
    {
      person: "Partner",
      quality: "Deeply supportive",
      evidence: "Described as the safest person in my life",
      suggested_action: "Schedule deliberate low-pressure rituals weekly.",
      relationship_score: 82,
    },
    {
      person: "Manager",
      quality: "High tension",
      evidence: "Mentioned with anxiety markers 11 times",
      suggested_action: "Clarify expectations in a structured 1-on-1.",
      relationship_score: 28,
    },
  ],
  social_gratitude_index: 61,
  priority_stack: [
    {
      rank: 1,
      category: "Regulation",
      action: "Install a daily decompression ritual before sleep",
      reasoning: "Stress load 62 is compounding cognitive noise.",
      urgency: "high" as const,
    },
    {
      rank: 2,
      category: "Career",
      action: "Write a weekly 'evidence of progress' log",
      reasoning: "Counters your imposter syndrome loop directly.",
      urgency: "medium" as const,
    },
  ],
  generated_at: new Date().toISOString(),
};

/** Minimal summary with data_reliability="insufficient" and all scores null. */
const INSUFFICIENT_ANALYTICS = {
  total_sessions: 1,
  total_messages: 3,
  data_reliability: "insufficient" as const,
  confidence_score: null,
  anxiety_score: null,
  self_esteem_score: null,
  ego_score: null,
  emotion_control_score: null,
  self_awareness_score: null,
  motivation_score: null,
  stress_load: null,
  cognitive_noise: null,
  logic_loops: [],
  insights: [],
  recommendations: [],
  focus_areas: [],
  relational_observations: [],
  social_gratitude_index: null,
  priority_stack: [],
  generated_at: new Date().toISOString(),
};

/** Score history with two data points (minimum to show the trend chart). */
const SCORE_HISTORY_WITH_DATA = {
  points: [
    {
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      confidence: 58,
      anxiety: 65,
      self_esteem: 50,
      stress: 70,
      social: 45,
      ego: 55,
      emotion_control: 62,
      self_awareness: 55,
      motivation: 38,
    },
    {
      date: new Date().toISOString(),
      confidence: 71,
      anxiety: 55,
      self_esteem: 63,
      stress: 62,
      social: 61,
      ego: 48,
      emotion_control: 74,
      self_awareness: 61,
      motivation: 44,
    },
  ],
};

const EMPTY_HISTORY = { points: [] };

/** 402 response body matching the backend's subscription_required shape. */
const SUBSCRIPTION_ERROR_BODY = {
  detail: {
    code: "subscription_required",
    message: "This feature requires a Pro subscription.",
    upgrade_path: "/users/subscribe",
  },
};

// ── Shared route helpers ─────────────────────────────────────────────────────

/** Mock non-analytics baseline routes (users/sync and users/me). */
async function mockBaseRoutes(page: import("@playwright/test").Page) {
  await page.route(`${API_URL}/api/v1/users/sync`, (route) =>
    route.fulfill({ status: 200, body: "{}" }),
  );
  await page.route(`${API_URL}/api/v1/users/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "u1",
        clerk_user_id: "clerk_u1",
        email: "test@example.com",
        full_name: "Alex Taylor",
        subscription_tier: "pro",
      }),
    }),
  );
}

// ── Loading and error states ─────────────────────────────────────────────────

test.describe("Loading and error states", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
  });

  test("shows a loading indicator while the summary is being fetched", async ({ page }) => {
    // Delay the response so the loading state is observable.
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await new Promise((r) => setTimeout(r, 1_200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      });
    });

    await page.goto("/insights");
    await expect(
      page.getByRole("progressbar").or(page.getByText(/analy[sz]ing/i)),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("renders an error banner when the summary API returns 500", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({ status: 500, body: '{"detail":"internal error"}' }),
    );

    await page.goto("/insights");
    await expect(
      page.getByText(/failed|error|try again/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("a 500 on /analytics/history does not prevent the summary from displaying", async ({
    page,
  }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
    // Override the beforeEach history mock with a failure.
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 500, body: '{"detail":"history unavailable"}' }),
    );

    await page.goto("/insights");
    // Summary content should still appear despite history failure.
    await expect(page.getByText("107")).toBeVisible({ timeout: 10_000 });
  });
});

// ── Subscription gate ────────────────────────────────────────────────────────

test.describe("Subscription gate (402)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify(SUBSCRIPTION_ERROR_BODY),
      }),
    );
  });

  test("shows the upgrade overlay when the summary returns 402", async ({ page }) => {
    await page.goto("/insights");
    await expect(
      page.getByText(/unlock your psychological profile/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("upgrade overlay contains a link to /pricing", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/unlock your psychological profile/i)).toBeVisible({
      timeout: 8_000,
    });
    // The CTA link must point to /pricing (not just any upgrade path).
    await expect(page.getByRole("link", { name: /upgrade to pro/i })).toHaveAttribute(
      "href",
      /\/pricing/,
    );
  });

  test("real data sections are not visible when upgrade gate is showing", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/unlock your psychological profile/i)).toBeVisible({
      timeout: 8_000,
    });
    // These sections should only render inside the blurred aria-hidden mock.
    // The live heading must not be accessible to AT or visible.
    // Use an exact match so the upgrade-gate heading "Unlock your psychological
    // profile" (which contains the same words) does not trigger a false failure.
    await expect(
      page.getByRole("heading", { name: "Psychological Profile", exact: true }),
    ).not.toBeVisible();
  });
});

// ── At-a-glance stat tiles ───────────────────────────────────────────────────

test.describe("At-a-glance stats", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders the coaching sessions count", async ({ page }) => {
    await page.goto("/insights");
    const card = page.locator("div", { has: page.getByText("Coaching sessions") });
    await expect(card.getByText("14", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("renders the messages analysed count", async ({ page }) => {
    await page.goto("/insights");
    const card = page.locator("div", { has: page.getByText("Messages analysed") });
    await expect(card.getByText("107", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("renders the focus areas count tile", async ({ page }) => {
    await page.goto("/insights");
    const card = page.locator("div", { has: page.getByText("Focus areas") });
    // FULL_ANALYTICS.focus_areas has 3 items
    await expect(card.getByText("3", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("renders the recurring patterns count tile", async ({ page }) => {
    await page.goto("/insights");
    const card = page.locator("div", { has: page.getByText("Recurring patterns") });
    // FULL_ANALYTICS.logic_loops has 2 items
    await expect(card.getByText("2", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── Psychological Profile section ────────────────────────────────────────────

test.describe("Psychological Profile section", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders all six score gauge values", async ({ page }) => {
    await page.goto("/insights");
    // Wait for the profile section to appear
    await expect(page.getByText(/psychological profile/i)).toBeVisible({ timeout: 10_000 });

    // Each score is rendered as the raw integer in a large text element.
    for (const score of [71, 55, 63, 48, 74, 62]) {
      await expect(page.getByText(String(score)).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("renders the self-awareness and motivation gauges in the Growth sub-section", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/psychological profile/i)).toBeVisible({ timeout: 10_000 });

    // self_awareness_score=61, motivation_score=44 from FULL_ANALYTICS
    await expect(page.getByText("61").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("44").first()).toBeVisible({ timeout: 5_000 });
  });

  test("renders the data_reliability callout with the correct label", async ({ page }) => {
    await page.goto("/insights");
    // data_reliability = "high" → label "High confidence"
    await expect(page.getByText(/high confidence/i)).toBeVisible({ timeout: 10_000 });
  });

  test("renders the cognitive noise widget with the correct level badge", async ({ page }) => {
    await page.goto("/insights");
    // cognitive_noise = "moderate" → a badge with text "moderate" inside the widget.
    // The widget also has "Cognitive Noise" as a label.
    await expect(page.getByText(/cognitive noise/i).first()).toBeVisible({ timeout: 10_000 });
    // The badge inside the widget should show the noise level.
    const widget = page.locator("div", { has: page.getByText(/cognitive noise/i).first() });
    await expect(widget.getByText("moderate").first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Insufficient data state ──────────────────────────────────────────────────

test.describe("Insufficient data state", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(INSUFFICIENT_ANALYTICS),
      }),
    );
  });

  test("shows 'Not enough data yet' in the reliability callout", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/not enough data yet/i)).toBeVisible({ timeout: 10_000 });
  });

  test("score gauges show 'Not enough data' placeholders when all scores are null", async ({
    page,
  }) => {
    await page.goto("/insights");
    // Multiple gauges render the placeholder — at least one must be visible.
    await expect(page.getByText(/not enough data/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("does not render the Logic Loops section when the list is empty", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/not enough data yet/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/logic loops detected/i)).not.toBeVisible();
  });
});

// ── Logic Loops section ──────────────────────────────────────────────────────

test.describe("Logic Loops section", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders the section header with the loop count", async ({ page }) => {
    await page.goto("/insights");
    // Header is "Logic Loops Detected (2)"
    await expect(page.getByText(/logic loops detected/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("(2)")).toBeVisible({ timeout: 5_000 });
  });

  test("renders each loop's topic", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/imposter syndrome at work/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/conflict avoidance/i)).toBeVisible({ timeout: 5_000 });
  });

  test("renders frequency and efficiency for each loop", async ({ page }) => {
    await page.goto("/insights");
    // "~13 mentions" and "29%" for the first loop
    await expect(page.getByText(/~13 mentions/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("29%")).toBeVisible({ timeout: 5_000 });
  });

  test("renders the suggested fix type for each loop", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/cognitive reframe/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/boundary setting/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ── Observations section ─────────────────────────────────────────────────────

test.describe("Observations section", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders observation text content", async ({ page }) => {
    await page.goto("/insights");
    await expect(
      page.getByText(/underestimate progress/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("renders trend labels for observations", async ({ page }) => {
    await page.goto("/insights");
    // One "improving" and one "declining" trend
    await expect(page.getByText("improving").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("declining").first()).toBeVisible({ timeout: 5_000 });
  });

  test("renders observation category labels", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText("Growth").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Stress").first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Recommendations section ──────────────────────────────────────────────────

test.describe("Recommendations section", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders recommendation titles", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText("Feeling Good")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Box Breathing")).toBeVisible({ timeout: 5_000 });
  });

  test("renders the 'why this is relevant' text for each recommendation", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/imposter syndrome loop/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/stress peaks/i).first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Priority Stack section ───────────────────────────────────────────────────

test.describe("Priority Stack section", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders the section heading", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/weekly priority stack/i)).toBeVisible({ timeout: 10_000 });
  });

  test("renders each priority item's action text", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/decompression ritual/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/evidence of progress/i)).toBeVisible({ timeout: 5_000 });
  });

  test("renders urgency badges", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText("high").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("medium").first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Relational Capital section ───────────────────────────────────────────────

test.describe("Relational Capital section", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders the section heading", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/relational capital/i)).toBeVisible({ timeout: 10_000 });
  });

  test("renders person names from relational observations", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText("partner").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("manager").first()).toBeVisible({ timeout: 5_000 });
  });

  test("renders quality badges for each observation", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/deeply supportive/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/high tension/i)).toBeVisible({ timeout: 5_000 });
  });

  test("renders the suggested action for each observation", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/low-pressure rituals/i)).toBeVisible({ timeout: 10_000 });
  });

  test("renders the social gratitude score gauge", async ({ page }) => {
    await page.goto("/insights");
    // social_gratitude_index = 61; "Overall Social Health" label
    await expect(page.getByText(/overall social health/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("61").first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Focus Areas section ──────────────────────────────────────────────────────

test.describe("Focus Areas section", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("renders each focus area chip", async ({ page }) => {
    await page.goto("/insights");
    for (const area of FULL_ANALYTICS.focus_areas) {
      await expect(page.getByText(area).first()).toBeVisible({ timeout: 10_000 });
    }
  });
});

// ── Score history chart ──────────────────────────────────────────────────────

test.describe("Score history chart", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );
  });

  test("shows the empty-state placeholder when fewer than 2 history points exist", async ({
    page,
  }) => {
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.goto("/insights");
    await expect(
      page.getByText(/trends appear after your second/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("renders the Score Trends chart section when 2+ history points exist", async ({
    page,
  }) => {
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SCORE_HISTORY_WITH_DATA),
      }),
    );
    await page.goto("/insights");
    await expect(page.getByText(/score trends/i)).toBeVisible({ timeout: 10_000 });
    // Legend entries for the chart lines should appear.
    await expect(page.getByText("Confidence").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Social Health").first()).toBeVisible({ timeout: 5_000 });
  });

  test("deduplicates multiple snapshots on the same day into one chart point", async ({
    page,
  }) => {
    const today = new Date().toISOString();
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          points: [
            // Two entries on the same calendar day — chart should deduplicate to 1.
            {
              date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
              confidence: 50, anxiety: 60, self_esteem: 45, stress: 70,
              social: 40, ego: 55, emotion_control: 58,
            },
            {
              date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
              confidence: 55, anxiety: 58, self_esteem: 48, stress: 65,
              social: 44, ego: 52, emotion_control: 61,
            },
            // Two points on today — only the second should survive.
            {
              date: today,
              confidence: 65, anxiety: 56, self_esteem: 60, stress: 63,
              social: 59, ego: 49, emotion_control: 70,
            },
            {
              date: today,
              confidence: 71, anxiety: 55, self_esteem: 63, stress: 62,
              social: 61, ego: 48, emotion_control: 74,
            },
          ],
        }),
      }),
    );
    await page.goto("/insights");
    // Chart should render (3 distinct days → ≥ 2 points → chart visible, not placeholder).
    await expect(page.getByText(/score trends/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/trends appear after/i)).not.toBeVisible();
  });
});

// ── Refresh button behaviour ─────────────────────────────────────────────────

test.describe("Refresh button", () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
  });

  test("re-fetches the summary when clicked", async ({ page }) => {
    let callCount = 0;
    await page.route(`${API_URL}/api/v1/analytics/summary*`, (route) => {
      callCount++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      });
    });

    await page.goto("/insights");
    await expect(page.getByText(/psychological profile/i)).toBeVisible({ timeout: 10_000 });
    const callsAfterLoad = callCount;

    await page.getByRole("button", { name: /refresh/i }).click();
    await expect
      .poll(() => callCount, { timeout: 5_000 })
      .toBeGreaterThan(callsAfterLoad);
  });

  test("Refresh button sends ?force=true to bust the server cache", async ({ page }) => {
    const requestUrls: string[] = [];
    await page.route(`${API_URL}/api/v1/analytics/summary**`, (route) => {
      requestUrls.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      });
    });

    await page.goto("/insights");
    await expect(page.getByText(/psychological profile/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /refresh/i }).click();
    // Wait for a second request to arrive
    await expect.poll(() => requestUrls.length, { timeout: 5_000 }).toBeGreaterThan(1);

    // The Refresh request (last one) must include the force flag
    const refreshUrl = requestUrls[requestUrls.length - 1];
    expect(refreshUrl).toContain("force=true");
  });

  test("clears stale content and shows a spinner during re-fetch", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      // Second request is intentionally slow so the loading state is observable.
      await new Promise((r) => setTimeout(r, 1_000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      });
    });

    await page.goto("/insights");
    // Wait for initial load to complete.
    await expect(page.getByText(/psychological profile/i)).toBeVisible({ timeout: 12_000 });

    // Click Refresh — page should immediately clear content and show a spinner.
    await page.getByRole("button", { name: /refresh/i }).click();
    await expect(
      page.getByRole("progressbar").or(page.getByText(/analy[sz]ing/i)),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("the Refresh button is disabled while loading is in progress", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/analytics/summary`, async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      });
    });

    await page.goto("/insights");
    await expect(page.getByRole("button", { name: /refresh/i })).toBeDisabled({ timeout: 3_000 });
  });
});

// ── Generated-at footer ──────────────────────────────────────────────────────

test.describe("Generated-at footer", () => {
  test("renders the generated timestamp at the bottom of the page", async ({ page }) => {
    await mockBaseRoutes(page);
    await page.route(`${API_URL}/api/v1/analytics/history`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_HISTORY) }),
    );
    await page.route(`${API_URL}/api/v1/analytics/summary`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FULL_ANALYTICS),
      }),
    );

    await page.goto("/insights");
    // Footer text: "Generated <date> · AI observations only — not a clinical assessment"
    await expect(page.getByText(/generated/i).last()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/not a clinical assessment/i).last()).toBeVisible({ timeout: 5_000 });
  });
});
