import { clampSkill } from "@/lib/skill/constants";

/** `Math.min(20, Math.max(0, attempts - 1) * 3)` */
export const ATTEMPT_PENALTY_MAX = 20;
const ATTEMPT_PENALTY_PER_EXTRA = 3;

/** `Math.min(15, wrongMoves * 0.5)` */
export const WRONG_MOVE_PENALTY_MAX = 15;
const WRONG_MOVE_PENALTY_RATE = 0.5;

export type PartMasteryInput = {
  bestScore: number;
  attempts: number;
  wrongMoves: number;
};

export function computeAttemptPenalty(attempts: number): number {
  return Math.min(
    ATTEMPT_PENALTY_MAX,
    Math.max(0, attempts - 1) * ATTEMPT_PENALTY_PER_EXTRA,
  );
}

export function computeWrongMovePenalty(wrongMoves: number): number {
  return Math.min(
    WRONG_MOVE_PENALTY_MAX,
    Math.max(0, wrongMoves) * WRONG_MOVE_PENALTY_RATE,
  );
}

/** Ordering-only — incomplete clips; never used by sectionSkill / EMA. */
export const PARTIAL_STRUGGLE_BASELINE = 40;
export const PARTIAL_STRUGGLE_MAX = 39;

/**
 * Synthetic struggle signal from attempts/wrongMoves only.
 * `clamp(40 - attemptPenalty - wrongMovePenalty, 0, 39)`
 */
export function partialStruggleOrderingSignal(
  attempts: number,
  wrongMoves: number,
): number {
  const raw =
    PARTIAL_STRUGGLE_BASELINE -
    computeAttemptPenalty(attempts) -
    computeWrongMovePenalty(wrongMoves);
  return Math.max(0, Math.min(PARTIAL_STRUGGLE_MAX, raw));
}

/** `clamp(bestScore - attemptPenalty - wrongMovePenalty, 0, 100)` */
export function computePartMasteryScore(input: PartMasteryInput): number {
  const raw =
    input.bestScore -
    computeAttemptPenalty(input.attempts) -
    computeWrongMovePenalty(input.wrongMoves);
  return clampSkill(raw);
}
