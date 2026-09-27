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

/** Score composition — attempt-based only (accuracy + mistakes/hints); no timing. */
export const SCORE_WEIGHTS = {
  accuracy: 77,
  consistency: 18,
  inputExpectation: 5,
} as const;

export const MIN_COVERAGE_FOR_FULL_SCORE = 0.7;

/** Reference sentence difficulty (~6–8 weighted tokens on a medium clip). */
export const REF_SENTENCE_DIFFICULTY = 7;

/** Drag is guided practice — scores cap below voice on the performance scale. */
export const DRAG_SCORE_CAP = 88;
