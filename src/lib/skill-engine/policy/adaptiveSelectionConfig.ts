/**
 * Configurable knobs for score-based adaptive selection.
 * All ranking / progression decisions use `difficultyScore` (0–100) only —
 * never `easy` / `medium` / `hard` labels.
 */

export type DifficultyZone = "near" | "easier" | "stretch";

export type AdaptiveSelectionConfig = {
  /** Half-width of the preferred band around user skill (skill ± toleranceHalfWidth). */
  toleranceHalfWidth: number;
  /** Easier confidence band offsets relative to user skill (e.g. −10..−5). */
  easierBand: { minOffset: number; maxOffset: number };
  /** Stretch / challenge band offsets relative to user skill (e.g. +5..+10). */
  stretchBand: { minOffset: number; maxOffset: number };
  /** Target mix when sequencing a session (should sum to ~1). */
  distributionTargets: Record<DifficultyZone, number>;
  /**
   * Only reorder within this many contiguous story units.
   * Windows preserve episode dialogue flow; no cross-episode jumps.
   */
  reorderWindowSize: number;
  /** Penalty per unit of canonical-order displacement inside a window. */
  continuityPenaltyPerStep: number;
  /** Used when `difficultyScore` is null (legacy rows). */
  defaultDifficultyScore: number;
  /** Safety cap on adjacent atomic clips merged into one learning unit. */
  maxMergeUnitCount: number;
};

export const DEFAULT_ADAPTIVE_SELECTION_CONFIG: AdaptiveSelectionConfig = {
  toleranceHalfWidth: 5,
  easierBand: { minOffset: -10, maxOffset: -5 },
  stretchBand: { minOffset: 5, maxOffset: 10 },
  distributionTargets: { near: 0.7, easier: 0.2, stretch: 0.1 },
  reorderWindowSize: 8,
  /** High enough that story order dominates; nudges allow ~1 adjacent swap. */
  continuityPenaltyPerStep: 20,
  defaultDifficultyScore: 50,
  maxMergeUnitCount: 12,
};

export function clampScore(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/** Preferred difficulty band: userSkill ± toleranceHalfWidth. */
export function preferredRange(
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): { min: number; max: number } {
  const half = config.toleranceHalfWidth;
  return {
    min: clampScore(userSkill - half),
    max: clampScore(userSkill + half),
  };
}

export function isWithinPreferredRange(
  difficultyScore: number,
  userSkill: number,
  config: AdaptiveSelectionConfig = DEFAULT_ADAPTIVE_SELECTION_CONFIG,
): boolean {
  const { min, max } = preferredRange(userSkill, config);
  return difficultyScore >= min && difficultyScore <= max;
}
