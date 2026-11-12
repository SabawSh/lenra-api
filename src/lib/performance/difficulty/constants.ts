import type { PartDifficulty } from "@/types/video";

/** Base weight tiers when explicit token difficulty is absent. */
export const TOKEN_WEIGHT_TIER = {
  easy: 1,
  medium: 1.5,
  hard: 2.2,
} as const;

export const CLIP_DIFFICULTY_FACTOR: Record<PartDifficulty, number> = {
  easy: 0.9,
  medium: 1,
  hard: 1.12,
};

/**
 * Clip score composition (points out of 100). Every part comes from something
 * measured during the attempt:
 * - correctness: share of the sentence built correctly
 * - pronunciation (voice): how closely the speech engine's words matched the line
 * - attempts: wrong moves, hints, failed / silent mic holds
 * - time: recall + answer time vs. a length/difficulty-aware expectation,
 *   excluding mic permission and speech-engine start-up
 */
export const SCORE_WEIGHTS = {
  voice: { correctness: 40, pronunciation: 25, attempts: 20, time: 15 },
  drag: { correctness: 50, pronunciation: 0, attempts: 35, time: 15 },
} as const;

/** Share of the attempts bucket lost per event (bucket floors at 0). */
export const ATTEMPT_COST = {
  wrongMove: 0.15,
  hint: 0.2,
  speakingRetry: 0.12,
  speakingAbandon: 0.05,
} as const;

/** Pronunciation match → credit: full at/above `full`, none at/below `zero`. */
export const PRONUNCIATION_CREDIT = { zero: 0.5, full: 0.95 } as const;

/**
 * Time ratio (expected ÷ actual, capped at 1) → credit. At or above `full`
 * (a bit slower than expected) still earns everything; only clearly slow
 * answers lose points, reaching zero at `zero`.
 */
export const TIME_CREDIT = { zero: 0.2, full: 0.75 } as const;

export const MIN_COVERAGE_FOR_FULL_SCORE = 0.7;

/** Reference sentence difficulty (~6–8 weighted tokens on a medium clip). */
export const REF_SENTENCE_DIFFICULTY = 7;

/** Drag is guided practice — scores cap below voice on the performance scale. */
export const DRAG_SCORE_CAP = 88;
