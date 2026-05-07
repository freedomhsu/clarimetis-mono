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
