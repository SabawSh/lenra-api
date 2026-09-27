/** Set `NEXT_PUBLIC_MERGE_DEBUG=1` to log learning-unit merge diagnostics. */
export const MERGE_DEBUG =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_MERGE_DEBUG === "1";

export type MergeDebugContext = {
  sectionIndex?: number;
  userSkill: number;
  anchorOrder: number;
  completedPartIds: string[];
  partOrders: number[];
};

export function logMergeDebug(_ctx: MergeDebugContext): void {}

export type PartStateLog = {
  order: number;
  difficulty: number | null;
  speechDurationMs: number;
  completed: boolean;
  beforeAnchor: boolean;
  atomicReason?: "completed" | "beforeAnchor";
};

export function logPartState(_entry: PartStateLog): void {}

export type MergeAttemptLog = {
  currentOrder: number;
  nextOrder: number;
  projectedDifficulty: number;
  projectedWords: number;
  projectedSpeechDuration: number;
  targetDifficultyCeiling: number;
  decision: "merge" | "reject";
  rejectionReason?: string;
};

export function logMergeAttempt(_entry: MergeAttemptLog): void {}

export type LearningUnitSummary = {
  partOrders: number[];
  mergedPartCount: number;
};

export type ReplayMergeModeLog = {
  sectionId?: string;
  sectionIndex?: number;
  replayMergeEnabled: boolean;
  learningUnitsBefore?: LearningUnitSummary[];
  learningUnitsAfter?: LearningUnitSummary[];
};

export function logReplayMergeMode(_entry: ReplayMergeModeLog): void {}
