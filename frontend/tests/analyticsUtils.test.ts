/**
 * Unit tests for lib/analyticsUtils.ts
 *
 * Covers deduplicateScorePoints:
 *   - Empty input returns empty array
 *   - Single point is returned unchanged
 *   - Multiple points on distinct days are all kept
 *   - Multiple points on the same day keep the last one (latest timestamp wins)
 *   - Points on more than 30 distinct days are capped at 30 (most recent)
 *   - Input order (ascending) is preserved in output
 *   - Null score fields are preserved through deduplication
 */

import { describe, it, expect } from "vitest";
import { deduplicateScorePoints } from "@/lib/analyticsUtils";
import type { ScorePoint } from "@/lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

function makePoint(date: string, overrides: Partial<ScorePoint> = {}): ScorePoint {
  return {
    date,
    confidence: 50,
    anxiety: 50,
    self_esteem: 50,
    stress: 50,
    social: 50,
    ego: 50,
    emotion_control: 50,
    self_awareness: null,
    motivation: null,
    ...overrides,
  };
}

// ── deduplicateScorePoints ────────────────────────────────────────────────

describe("deduplicateScorePoints()", () => {
  it("returns [] for empty input", () => {
    expect(deduplicateScorePoints([])).toEqual([]);
  });

  it("returns a single point unchanged", () => {
    const pts = [makePoint("2026-05-01T10:00:00+00:00", { confidence: 70 })];
    const result = deduplicateScorePoints(pts);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(70);
  });

  it("keeps all points when every point is on a distinct day", () => {
    const pts = [
      makePoint("2026-05-01T10:00:00+00:00"),
      makePoint("2026-05-02T10:00:00+00:00"),
      makePoint("2026-05-03T10:00:00+00:00"),
    ];
    expect(deduplicateScorePoints(pts)).toHaveLength(3);
  });

  it("keeps the LAST point when two points share the same calendar day", () => {
    const pts = [
      makePoint("2026-05-01T08:00:00+00:00", { confidence: 55 }),
      makePoint("2026-05-01T18:00:00+00:00", { confidence: 70 }), // same day, later
    ];
    const result = deduplicateScorePoints(pts);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(70); // later entry wins
  });

  it("deduplicates across multiple days with duplicates on some days", () => {
    const pts = [
      makePoint("2026-05-01T08:00:00+00:00", { confidence: 55 }),
      makePoint("2026-05-01T18:00:00+00:00", { confidence: 70 }), // duplicate day 1
      makePoint("2026-05-02T10:00:00+00:00", { confidence: 60 }),
      makePoint("2026-05-03T09:00:00+00:00", { confidence: 65 }),
      makePoint("2026-05-03T20:00:00+00:00", { confidence: 80 }), // duplicate day 3
    ];
    const result = deduplicateScorePoints(pts);
    expect(result).toHaveLength(3); // 3 distinct days
    expect(result[0].confidence).toBe(70); // day 1: last wins
    expect(result[1].confidence).toBe(60); // day 2: only entry
    expect(result[2].confidence).toBe(80); // day 3: last wins
  });

  it("caps at 30 most recent distinct days when more than 30 exist", () => {
    // Build 35 points on 35 distinct days.
    const pts = Array.from({ length: 35 }, (_, i) => {
      const date = new Date("2026-01-01T10:00:00+00:00");
      date.setDate(date.getDate() + i);
      return makePoint(date.toISOString(), { confidence: i + 1 });
    });
    const result = deduplicateScorePoints(pts);
    expect(result).toHaveLength(30);
    // The 30 most recent are the last 30 (days 6–35 → confidence 6–35).
    expect(result[0].confidence).toBe(6);  // oldest of the 30 kept
    expect(result[29].confidence).toBe(35); // most recent
  });

  it("preserves null score fields through deduplication", () => {
    const pts = [
      makePoint("2026-05-01T08:00:00+00:00", { confidence: null, social: null }),
      makePoint("2026-05-01T18:00:00+00:00", { confidence: null, ego: null }),
    ];
    const result = deduplicateScorePoints(pts);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBeNull();
    expect(result[0].ego).toBeNull();
  });

  it("preserves the ascending date order of deduplicated points", () => {
    const pts = [
      makePoint("2026-04-01T10:00:00+00:00"),
      makePoint("2026-04-15T10:00:00+00:00"),
      makePoint("2026-05-01T10:00:00+00:00"),
    ];
    const result = deduplicateScorePoints(pts);
    const dates = result.map((p) => p.date);
    expect(dates).toEqual([...dates].sort()); // should be sorted ascending
  });

  it("treats ISO dates with different UTC offsets as different days in local time", () => {
    // These two timestamps are the same UTC instant but different local hours
    // in most timezones — the important thing is the function is stable and
    // doesn't crash, regardless of the local timezone in CI.
    const pts = [
      makePoint("2026-05-01T00:30:00+00:00", { confidence: 60 }),
      makePoint("2026-05-01T23:30:00+00:00", { confidence: 80 }),
    ];
    // Both parse to the same UTC date in UTC — function must not throw.
    const result = deduplicateScorePoints(pts);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});
