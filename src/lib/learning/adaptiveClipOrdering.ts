import {
  getOrderingSignal,
  resolvePartState,
  sortAdaptiveParts,
} from "@/lib/skill-engine";

export type {
  AdaptivePartInput,
  MasteryResult,
  OrderingDiagnostics,
  OrderingSignal,
  PartProgress,
  PartState as OrderingLearningState,
} from "@/lib/skill-engine/domain/types";

export type { AdaptiveSelectionConfig } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

export { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
export { assignTier } from "@/lib/skill-engine/policy/assignTier";
export { contentDifficulty } from "@/lib/skill-engine/ordering/contentDifficulty";
export { computeEffectiveDifficulty as effectiveDifficulty } from "@/lib/skill-engine/ordering/effectiveDifficulty";
export {
  adaptiveOrderingDecisionInputs,
  resolveOrderingDiagnostics,
} from "@/lib/skill-engine/ordering/diagnostics";
export {
  classifyDifficultyZone,
  difficultyMatchDistance,
} from "@/lib/skill-engine/ordering/difficultyZones";
export {
  DEFAULT_ADAPTIVE_SELECTION_CONFIG,
  isWithinPreferredRange,
  preferredRange as difficultyPreferredRange,
} from "@/lib/skill-engine/policy/adaptiveSelectionConfig";
export {
  masteryScoreOfProgress as masteryScoreOf,
  resolvePartState as resolveOrderingState,
} from "@/lib/skill-engine/state/resolvePartState";

export { getOrderingSignal as orderingLearningSignal, sortAdaptiveParts };

export {
  buildLearningUnits,
  flattenLearningUnits,
  learningUnitAtStep,
  sessionStepForStoryOrder,
  computeUnitMetrics,
  resolveMemoryBudget,
  DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  DEFAULT_MEMORY_BUDGET_CONFIG,
  type AtomicPartInput,
  type LearningUnit,
  type LearningUnitBuilderConfig,
  type LearningUnitMetrics,
  type MemoryBudget,
  type MemoryBudgetConfig,
} from "@/lib/skill-engine/learning-units";

/** @deprecated Practice modes removed — pass `config` to `sortAdaptiveParts` instead. */
export type PracticeMode = "easy" | "medium" | "hard";
