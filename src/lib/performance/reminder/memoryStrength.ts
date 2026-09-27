import type { PerformanceResult, ReminderLevel } from "@/types/learning";

import type { ReminderSchedulingContext } from "./types";

/**
 * 0–100 memory strength from how the learner actually performed.
 * Higher = stronger recall → longer spacing. Content difficulty is ignored.
 */
export function computeMemoryStrength(
  performance: PerformanceResult,
  ctx?: ReminderSchedulingContext,
): number {
  let strength = performance.score;

  if (performance.inputMode === "voice") {
    strength += performance.isPerfectRun ? 14 : 8;
    strength += performance.accuracy * 10;
    strength += performance.speed * 8;
  } else {
    strength -= 20;
    strength += performance.accuracy * 5;
    strength += performance.speed * 3;
  }

  strength += performance.coverage * 6;

  strength -= performance.wrongMoves * 5.5;
  if (performance.wrongMoves >= 6) {
    strength = Math.min(strength, 12);
  } else if (performance.wrongMoves >= 4) {
    strength = Math.min(strength, 25);
  } else if (performance.wrongMoves >= 3) {
    strength -= 10;
  }

  strength -= performance.hintsUsed * 7;
  if (performance.hintsUsed >= 3) {
    strength = Math.min(strength, 20);
  } else if (performance.hintsUsed >= 2) {
    strength -= 8;
  }

  const attempts = Math.max(1, ctx?.attempts ?? 1);
  if (attempts > 1) {
    strength -= (attempts - 1) * 8;
  }
  if (attempts >= 3) {
    strength = Math.min(strength, 30);
  }

  const clipSec = Math.max(4, (ctx?.videoDurationMs ?? 0) / 1000);
  const chunks = Math.max(1, ctx?.chunkCount ?? 1);
  const expectedCeiling = Math.max(14, clipSec * 2.2 + chunks * 5);
  if (performance.durationSec > expectedCeiling) {
    const ratio = performance.durationSec / expectedCeiling;
    strength -= Math.min(28, Math.round((ratio - 1) * 18));
  }

  if (performance.speed < 0.38) strength -= 12;
  else if (performance.speed < 0.52) strength -= 6;
  else if (performance.speed >= 0.75) strength += 6;

  if (performance.wrongMoves === 0 && performance.hintsUsed === 0) {
    strength += 5;
  }

  if (performance.inputMode === "drag" && performance.wrongMoves >= 2) {
    strength -= 8;
  }

  return Math.max(0, Math.min(100, Math.round(strength)));
}

/** Heavy struggle → reinforce today (0 days). */
export function requiresSameDayReview(
  performance: PerformanceResult,
  strength: number,
  ctx?: ReminderSchedulingContext,
): boolean {
  if (strength <= 20) return true;
  if (performance.score < 50) return true;
  if (performance.wrongMoves >= 6) return true;
  if (performance.wrongMoves >= 4) return true;
  if (performance.hintsUsed >= 3) return true;
  if (performance.inputMode === "drag" && performance.wrongMoves >= 3) return true;
  if (performance.hintsUsed >= 2 && performance.score < 65) return true;
  if ((ctx?.attempts ?? 1) >= 3) return true;
  if (performance.inputMode === "drag" && strength < 45) return true;
  return false;
}

/** Suggested self-assessment from inferred strength + slips. */
export function recommendedReminderLevel(
  performance: PerformanceResult,
  strength: number,
): ReminderLevel {
  if (
    performance.level === "weak" ||
    strength < 38 ||
    performance.wrongMoves >= 4 ||
    performance.hintsUsed >= 2
  ) {
    return "hard";
  }
  if (
    performance.level === "excellent" &&
    strength >= 78 &&
    performance.wrongMoves <= 1 &&
    performance.hintsUsed === 0
  ) {
    return "easy";
  }
  if (strength >= 72 && performance.wrongMoves === 0) return "easy";
  return "normal";
}
