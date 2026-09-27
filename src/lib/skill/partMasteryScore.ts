import {
  ATTEMPT_PENALTY_MAX,
  computeAttemptPenalty,
  computePartMasteryScore,
  computeWrongMovePenalty,
  PARTIAL_STRUGGLE_BASELINE,
  PARTIAL_STRUGGLE_MAX,
  partialStruggleOrderingSignal,
  WRONG_MOVE_PENALTY_MAX,
  type PartMasteryInput,
} from "@/lib/skill-engine/mastery/partMastery";

export {
  ATTEMPT_PENALTY_MAX,
  computePartMasteryScore,
  PARTIAL_STRUGGLE_BASELINE,
  PARTIAL_STRUGGLE_MAX,
  partialStruggleOrderingSignal,
  WRONG_MOVE_PENALTY_MAX,
  type PartMasteryInput,
};

export const attemptPenalty = computeAttemptPenalty;
export const wrongMovePenalty = computeWrongMovePenalty;

export type SectionMasteryBreakdown = {
  qualified: boolean;
  sectionScore: number;
  averageBestScore: number;
  averageMasteryScore: number;
  averageAttempts: number;
  averageWrongMoves: number;
  /** Mean content difficultyScore across the section (null when unscored). */
  averageDifficulty: number | null;
  partCount: number;
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Section score = average(partMasteryScore) over qualified parts.
 * Caller must pass one row per section part (missing progress → unqualified).
 */
export function aggregateSectionMastery(
  parts: Array<
    PartMasteryInput & {
      completedAt: Date | null;
      /** Content difficulty (0-100); independent of completion. */
      difficultyScore?: number | null;
    }
  >,
): SectionMasteryBreakdown {
  const partCount = parts.length;

  // Content difficulty is a property of the material, so average it over every
  // part (not just qualified ones); null only when no part carries a score.
  const difficulties = parts
    .map((p) => p.difficultyScore)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const averageDifficulty =
    difficulties.length > 0 ? average(difficulties) : null;

  if (partCount === 0) {
    return {
      qualified: false,
      sectionScore: 0,
      averageBestScore: 0,
      averageMasteryScore: 0,
      averageAttempts: 0,
      averageWrongMoves: 0,
      averageDifficulty: null,
      partCount: 0,
    };
  }

  const qualified = parts.filter(
    (p) => p.completedAt != null && p.bestScore > 0,
  );
  const fullyQualified = qualified.length === partCount;

  if (!fullyQualified) {
    return {
      qualified: false,
      sectionScore: 0,
      averageBestScore: 0,
      averageMasteryScore: 0,
      averageAttempts: 0,
      averageWrongMoves: 0,
      averageDifficulty,
      partCount,
    };
  }

  const masteryScores = qualified.map((p) => computePartMasteryScore(p));

  return {
    qualified: true,
    sectionScore: average(masteryScores),
    averageBestScore: average(qualified.map((p) => p.bestScore)),
    averageMasteryScore: average(masteryScores),
    averageAttempts: average(qualified.map((p) => p.attempts)),
    averageWrongMoves: average(qualified.map((p) => p.wrongMoves)),
    averageDifficulty,
    partCount,
  };
}
