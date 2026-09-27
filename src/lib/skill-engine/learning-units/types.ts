import type { PartProgress } from "@/lib/skill-engine/domain/types";
import type {
  AdaptiveSelectionConfig,
  DifficultyZone,
} from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

/** Atomic clip from the content pipeline — one sentence (sometimes two short ones). */
export type AtomicPartInput = {
  id: string;
  /** 1-based story position within the episode / curriculum. */
  order: number;
  /** Primary difficulty signal (0–100). Used for all merge decisions. */
  difficultyScore: number | null;
  wordCount: number;
  /** Spoken content length — never padded clip duration. */
  speechDurationMs: number;
  progress?: PartProgress | null;
  dueToday?: boolean;
};

export type LearningUnitMetrics = {
  /** Sum of constituent part `difficultyScore` values. */
  difficulty: number;
  wordCount: number;
  /** Sum of constituent part speech durations. */
  speechDurationMs: number;
};

export type LearningUnitPartRef = Pick<
  AtomicPartInput,
  "id" | "order"
>;

export type LearningUnit<T extends LearningUnitPartRef = AtomicPartInput> = {
  parts: T[];
  metrics: LearningUnitMetrics;
  /** Zone targeted when this unit was built (success / challenge mix). */
  targetZone: DifficultyZone;
};

export type MemoryBudget = {
  maxWords: number;
  maxDurationMs: number;
};

/** Skill-tier memory limits — evaluated top-to-bottom; first matching tier wins. */
export type MemoryBudgetConfig = {
  tiers: ReadonlyArray<{
    /** Apply when `userSkill < maxSkillExclusive`. */
    maxSkillExclusive: number;
    budget: MemoryBudget;
  }>;
  /** Used when skill is at or above every tier's `maxSkillExclusive`. */
  defaultBudget: MemoryBudget;
};

export type LearningUnitBuilderConfig = AdaptiveSelectionConfig & {
  memoryBudget: MemoryBudgetConfig;
};
