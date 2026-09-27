import { clampSkill } from "@/lib/skill/constants";

/**
 * IRT-style skill calibration.
 *
 * A learner's ability is inferred from the DIFFICULTY of the content they
 * handled — not from their raw score on it. Acing difficulty-25 content proves
 * "a little above 25", never "expert". Anchoring the section EMA to content
 * difficulty is what stops the level from sprinting after a few easy perfect
 * rounds (the "beginner aces 10 cards → suddenly intermediate" cliff).
 */

/** Section mastery (performance) at/above this reads as a "comfortable pass". */
export const SKILL_TARGET_PASS_BASELINE = 70;

/** Skill points added/removed per mastery point away from the pass baseline. */
export const SKILL_TARGET_MARGIN_SCALE = 0.4;

/** A flawless section can imply at most this far ABOVE the content difficulty. */
export const SKILL_TARGET_MAX_ABOVE_DIFFICULTY = 12;

/** A failed section can imply at most this far BELOW the content difficulty. */
export const SKILL_TARGET_MAX_BELOW_DIFFICULTY = 15;

/**
 * Calibrated skill target for the section EMA — the ability the section is
 * EVIDENCE FOR, i.e. the value the EMA should chase.
 *
 * @param averageDifficulty mean content difficultyScore (0-100), or null for legacy rows.
 * @param sectionMastery    average partMasteryScore for the section (0-100 performance).
 * @returns clamped 0-100 target. Falls back to raw mastery when difficulty is
 *          unknown, preserving legacy behavior for content without scores.
 */
export function calibrateSkillTarget(
  averageDifficulty: number | null,
  sectionMastery: number,
): number {
  if (averageDifficulty == null || !Number.isFinite(averageDifficulty)) {
    return clampSkill(sectionMastery);
  }

  const margin =
    (sectionMastery - SKILL_TARGET_PASS_BASELINE) * SKILL_TARGET_MARGIN_SCALE;
  const boundedMargin = Math.max(
    -SKILL_TARGET_MAX_BELOW_DIFFICULTY,
    Math.min(SKILL_TARGET_MAX_ABOVE_DIFFICULTY, margin),
  );
  return clampSkill(averageDifficulty + boundedMargin);
}
