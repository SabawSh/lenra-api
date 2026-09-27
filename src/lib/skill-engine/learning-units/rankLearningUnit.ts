import { classifyDifficultyZone } from "@/lib/skill-engine/ordering/difficultyZones";
import { difficultyMatchDistance } from "@/lib/skill-engine/ordering/difficultyZones";
import type { DifficultyZone } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
import type {
  AtomicPartInput,
  LearningUnit,
} from "@/lib/skill-engine/learning-units/types";
import type { LearningUnitBuilderConfig } from "@/lib/skill-engine/learning-units/types";

/**
 * Lower score = higher priority when choosing among candidate units.
 * Priority: story continuity → memory compliance → difficulty match → zone → review.
 */
export function rankLearningUnit(
  unit: LearningUnit,
  userSkill: number,
  storyOrder: number,
  budget: { maxWords: number; maxDurationMs: number },
  config: LearningUnitBuilderConfig,
): number {
  const continuity = storyOrder * config.continuityPenaltyPerStep;

  const memoryOverflow =
    Math.max(0, unit.metrics.wordCount - budget.maxWords) * 4 +
    Math.max(0, unit.metrics.speechDurationMs - budget.maxDurationMs) * 0.002;

  const zone = classifyDifficultyZone(unit.metrics.difficulty, userSkill, config);
  const zoneRank =
    zone === unit.targetZone
      ? 0
      : zone === "near"
        ? 2
        : zone === "easier"
          ? 4
          : zone === "stretch"
            ? 6
            : 10;

  const match = difficultyMatchDistance(unit.metrics.difficulty, userSkill, config);

  let reviewBonus = 0;
  for (const part of unit.parts) {
    if (part.dueToday) reviewBonus += 1.5;
  }

  return continuity + memoryOverflow + match * 0.35 + zoneRank - reviewBonus;
}

/** Pick the highest-priority unit from candidates (story continuity should dominate). */
export function selectNextLearningUnit<T extends AtomicPartInput>(
  candidates: LearningUnit<T>[],
  userSkill: number,
  budget: { maxWords: number; maxDurationMs: number },
  config: LearningUnitBuilderConfig,
): LearningUnit<T> | null {
  if (candidates.length === 0) return null;

  let best = candidates[0]!;
  let bestScore = rankLearningUnit(
    best,
    userSkill,
    best.parts[0]?.order ?? 0,
    budget,
    config,
  );

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const score = rankLearningUnit(
      candidate,
      userSkill,
      candidate.parts[0]?.order ?? 0,
      budget,
      config,
    );
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function classifyUnitZone(
  unit: LearningUnit,
  userSkill: number,
  config: LearningUnitBuilderConfig,
): DifficultyZone | "outside" {
  return classifyDifficultyZone(unit.metrics.difficulty, userSkill, config);
}
