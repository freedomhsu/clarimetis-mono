import type { ScorePoint } from "@/lib/api";

/**
 * Deduplicate score history points to one entry per local calendar day.
 * When multiple points share the same day, the last one (latest timestamp)
 * wins — inputs must be in ascending chronological order.
 * Returns at most the 30 most recent distinct days.
 */
export function deduplicateScorePoints(points: ScorePoint[]): ScorePoint[] {
  const dayMap = new Map<string, ScorePoint>();
  for (const p of points) {
    const d = new Date(p.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dayMap.set(key, p);
  }
  return Array.from(dayMap.values()).slice(-30);
}

/**
 * Returns the last 30 score history points in chronological order without
 * any same-day deduplication — every snapshot is shown as an individual data
 * point so users can see all their sessions even when multiple fall on one day.
 */
export function allScorePoints(points: ScorePoint[]): ScorePoint[] {
  return points.slice(-30);
}

/**
 * Returns true when any two points in the array share the same local calendar
 * day. Used by the chart to decide whether to include time in x-axis labels.
 */
export function hasSameDayDuplicates(points: ScorePoint[]): boolean {
  const seen = new Set<string>();
  for (const p of points) {
    const d = new Date(p.date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
