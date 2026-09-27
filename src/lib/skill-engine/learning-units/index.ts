export {
  buildLearningUnits,
  flattenLearningUnits,
  learningUnitAtStep,
  sessionStepForStoryOrder,
  type BuildLearningUnitsOptions,
} from "@/lib/skill-engine/learning-units/buildLearningUnits";
export {
  canMergePart,
  computeUnitMetrics,
  mergeAdjacentParts,
} from "@/lib/skill-engine/learning-units/mergeAlgorithm";
export {
  DEFAULT_LEARNING_UNIT_BUILDER_CONFIG,
  DEFAULT_MEMORY_BUDGET_CONFIG,
  resolveMemoryBudget,
} from "@/lib/skill-engine/learning-units/memoryBudget";
export {
  classifyUnitZone,
  rankLearningUnit,
  selectNextLearningUnit,
} from "@/lib/skill-engine/learning-units/rankLearningUnit";
export type {
  AtomicPartInput,
  LearningUnit,
  LearningUnitBuilderConfig,
  LearningUnitMetrics,
  MemoryBudget,
  MemoryBudgetConfig,
} from "@/lib/skill-engine/learning-units/types";
