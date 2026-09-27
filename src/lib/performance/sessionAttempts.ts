import type { PerformanceRaw } from "@/types/learning";

/**
 * Interaction count for one completed clip session (one POST /api/performance).
 * Wrong moves and hints each count as an attempt; a flawless run is at least 1.
 */
export function countSessionAttempts(
  raw: Pick<PerformanceRaw, "wrongMoves" | "hintsUsed">,
): number {
  const interactions = Math.max(0, raw.wrongMoves) + Math.max(0, raw.hintsUsed);
  return Math.max(1, interactions);
}

/** Weighted running average when merging a new session into stored progress. */
export function aggregateSessionMetric(
  previousTotal: number,
  previousWeight: number,
  sessionValue: number,
  sessionWeight: number,
): number {
  const totalWeight = previousWeight + sessionWeight;
  if (totalWeight <= 0) return sessionValue;
  if (previousWeight <= 0) return sessionValue;
  return (
    (previousTotal * previousWeight + sessionValue * sessionWeight) /
    totalWeight
  );
}
