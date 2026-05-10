import type { ScorePoint } from "@/lib/api";

/**
 * Returns the last 30 score history points in chronological order.
 * No same-day deduplication — every snapshot is shown as an individual data
 * point so users can see all their sessions even when multiple fall on one day.
 * The x-axis label in the chart will include time when same-day duplicates exist.
 */
export function deduplicateScorePoints(points: ScorePoint[]): ScorePoint[] {
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
