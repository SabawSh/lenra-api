import type {
  LearningUnitBuilderConfig,
  MemoryBudget,
  MemoryBudgetConfig,
} from "@/lib/skill-engine/learning-units/types";

/**
 * The "max word rule": working-memory limits ramp in small steps (~2 words per
 * ~10 skill points) so sentence length grows gradually as the learner improves —
 * never a 12 → 16 → 22 leap. Anchor points (skill 15 → 8, 50 → 16, 85 → 30) are
 * preserved; the extra tiers only smooth the steps between them.
 */
export const DEFAULT_MEMORY_BUDGET_CONFIG: MemoryBudgetConfig = {
  tiers: [
    { maxSkillExclusive: 20, budget: { maxWords: 8, maxDurationMs: 5_000 } },
    { maxSkillExclusive: 30, budget: { maxWords: 10, maxDurationMs: 6_500 } },
    { maxSkillExclusive: 40, budget: { maxWords: 12, maxDurationMs: 8_000 } },
    { maxSkillExclusive: 50, budget: { maxWords: 14, maxDurationMs: 9_500 } },
    { maxSkillExclusive: 60, budget: { maxWords: 16, maxDurationMs: 11_000 } },
    { maxSkillExclusive: 70, budget: { maxWords: 19, maxDurationMs: 13_000 } },
    { maxSkillExclusive: 80, budget: { maxWords: 22, maxDurationMs: 15_000 } },
  ],
  defaultBudget: { maxWords: 30, maxDurationMs: 18_000 },
};

/** Resolve cognitive-load limits for a user skill score. */
export function resolveMemoryBudget(
  userSkill: number,
  config: MemoryBudgetConfig = DEFAULT_MEMORY_BUDGET_CONFIG,
): MemoryBudget {
  for (const tier of config.tiers) {
    if (userSkill < tier.maxSkillExclusive) {
      return tier.budget;
    }
  }
  return config.defaultBudget;
}

export const DEFAULT_LEARNING_UNIT_BUILDER_CONFIG: LearningUnitBuilderConfig = {
  toleranceHalfWidth: 5,
  easierBand: { minOffset: -10, maxOffset: -5 },
  stretchBand: { minOffset: 5, maxOffset: 10 },
  distributionTargets: { near: 0.7, easier: 0.2, stretch: 0.1 },
  reorderWindowSize: 8,
  continuityPenaltyPerStep: 20,
  defaultDifficultyScore: 50,
  maxMergeUnitCount: 12,
  memoryBudget: DEFAULT_MEMORY_BUDGET_CONFIG,
};
