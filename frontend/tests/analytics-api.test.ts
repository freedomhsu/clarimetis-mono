/**
 * Unit tests for api.getAnalytics() and api.getScoreHistory() in lib/api.ts.
 *
 * Covers:
 *   getAnalytics:
 *     - calls the correct URL path
 *     - sends the Authorization header
 *     - returns a parsed AnalyticsSummary on 200
 *     - throws with .subscriptionError on 402 (subscription_required)
 *     - throws plain Error on non-subscription errors (500)
 *
 *   getScoreHistory:
 *     - calls the correct URL path
 *     - sends the Authorization header
 *     - returns a parsed ScoreHistory on 200
 *     - throws with .subscriptionError on 402
 *     - returns empty points array when API returns { points: [] }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api";
import type { AnalyticsSummary, ScoreHistory } from "@/lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function subErrorResponse(status: 402 | 429, code: "subscription_required" | "daily_limit_reached") {
  return jsonResponse(
    { detail: { code, message: "Upgrade required", upgrade_path: "/users/subscribe" } },
    status,
  );
}

const FAKE_SUMMARY: AnalyticsSummary = {
  total_sessions: 12,
  total_messages: 84,
  data_reliability: "moderate",
  confidence_score: 65,
  anxiety_score: 42,
  self_esteem_score: 58,
  ego_score: 52,
  emotion_control_score: 67,
  self_awareness_score: null,
  motivation_score: null,
  stress_load: 38,
  cognitive_noise: "moderate",
  logic_loops: [{ topic: "Imposter syndrome", frequency: 9, efficiency: 35, fix_type: "Reframe" }],
  insights: [{ category: "Growth", observation: "Positive pattern.", trend: "improving" }],
  recommendations: [{ type: "practice", title: "Box Breathing", description: "4-4-4-4.", why: "Stress." }],
  focus_areas: ["Confidence", "Stress regulation"],
  relational_observations: [],
  social_gratitude_index: 61,
  priority_stack: [{ rank: 1, category: "Regulation", action: "Sleep ritual", reasoning: "Load.", urgency: "high" }],
  generated_at: new Date().toISOString(),
};

const FAKE_HISTORY: ScoreHistory = {
  points: [
    {
      date: "2026-04-01T10:00:00+00:00",
      confidence: 55,
      anxiety: 60,
      self_esteem: 48,
      stress: 70,
      social: 40,
      ego: 52,
      emotion_control: 60,
      self_awareness: null,
      motivation: null,
    },
    {
      date: "2026-05-01T10:00:00+00:00",
      confidence: 65,
      anxiety: 42,
      self_esteem: 58,
      stress: 38,
      social: 61,
      ego: 52,
      emotion_control: 67,
      self_awareness: null,
      motivation: null,
    },
  ],
};

// ── api.getAnalytics() ─────────────────────────────────────────────────────

describe("api.getAnalytics()", () => {
  it("calls /api/v1/analytics/summary", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_SUMMARY));
    await api.getAnalytics("tok");
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/analytics\/summary/);
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_SUMMARY));
    await api.getAnalytics("my-secret-token");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-secret-token",
    );
  });

  it("returns the parsed AnalyticsSummary on 200", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_SUMMARY));
    const result = await api.getAnalytics("tok");
    expect(result.total_sessions).toBe(12);
    expect(result.total_messages).toBe(84);
    expect(result.data_reliability).toBe("moderate");
    expect(result.confidence_score).toBe(65);
    expect(result.ego_score).toBe(52);
    expect(result.emotion_control_score).toBe(67);
    expect(result.logic_loops).toHaveLength(1);
    expect(result.logic_loops[0].topic).toBe("Imposter syndrome");
    expect(result.focus_areas).toEqual(["Confidence", "Stress regulation"]);
    expect(result.social_gratitude_index).toBe(61);
    expect(result.generated_at).toBeTruthy();
  });

  it("attaches .subscriptionError on 402 subscription_required", async () => {
    mockFetch.mockResolvedValue(subErrorResponse(402, "subscription_required"));
    const err = await api.getAnalytics("tok").catch((e) => e);
    expect(err.subscriptionError).toBeDefined();
    expect(err.subscriptionError.code).toBe("subscription_required");
    expect(err.subscriptionError.upgrade_path).toBe("/users/subscribe");
  });

  it("throws a plain Error (not subscriptionError) on 500", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ type: "internal_error" }, 500));
    const err = await api.getAnalytics("tok").catch((e) => e);
    expect(err.subscriptionError).toBeUndefined();
    expect(err.message).toMatch("500");
  });

  it("throws a plain Error with the detail message on non-subscription 4xx", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ detail: "User not found." }, 404));
    await expect(api.getAnalytics("tok")).rejects.toThrow("User not found.");
  });
});

// ── api.getScoreHistory() ─────────────────────────────────────────────────

describe("api.getScoreHistory()", () => {
  it("calls /api/v1/analytics/history", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_HISTORY));
    await api.getScoreHistory("tok");
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/analytics\/history/);
  });

  it("sends the Authorization bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_HISTORY));
    await api.getScoreHistory("my-secret-token");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-secret-token",
    );
  });

  it("returns a parsed ScoreHistory with all seven ScorePoint fields", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FAKE_HISTORY));
    const result = await api.getScoreHistory("tok");
    expect(result.points).toHaveLength(2);

    const pt = result.points[0];
    expect(pt.date).toBe("2026-04-01T10:00:00+00:00");
    expect(pt.confidence).toBe(55);
    expect(pt.anxiety).toBe(60);
    expect(pt.self_esteem).toBe(48);
    expect(pt.stress).toBe(70);
    expect(pt.social).toBe(40);      // social_gratitude_index → social
    expect(pt.ego).toBe(52);
    expect(pt.emotion_control).toBe(60);
  });

  it("returns empty points array when history is empty", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ points: [] }));
    const result = await api.getScoreHistory("tok");
    expect(result.points).toEqual([]);
  });

  it("attaches .subscriptionError on 402", async () => {
    mockFetch.mockResolvedValue(subErrorResponse(402, "subscription_required"));
    const err = await api.getScoreHistory("tok").catch((e) => e);
    expect(err.subscriptionError).toBeDefined();
    expect(err.subscriptionError.code).toBe("subscription_required");
  });

  it("throws a plain Error on non-subscription 5xx", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ type: "db_error" }, 500));
    const err = await api.getScoreHistory("tok").catch((e) => e);
    expect(err.subscriptionError).toBeUndefined();
    expect(err.message).toMatch("500");
  });

  it("handles null values in ScorePoint fields (insufficient data)", async () => {
    const sparseHistory: ScoreHistory = {
      points: [
        {
          date: "2026-05-01T10:00:00+00:00",
          confidence: null,
          anxiety: null,
          self_esteem: null,
          stress: null,
          social: null,
          ego: null,
          emotion_control: null,
          self_awareness: null,
          motivation: null,
        },
      ],
    };
    mockFetch.mockResolvedValue(jsonResponse(sparseHistory));
    const result = await api.getScoreHistory("tok");
    expect(result.points[0].confidence).toBeNull();
    expect(result.points[0].social).toBeNull();
  });
});
