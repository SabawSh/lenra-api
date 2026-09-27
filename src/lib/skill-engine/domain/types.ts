import { clampScore } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

/** @deprecated Practice modes removed — adaptive engine uses score tolerance only. */
export type PracticeMode = "easy" | "medium" | "hard";

export type PartProgress = {
  bestScore: number | null;
  completedAt: Date | null;
  attempts?: number | null;
  wrongMoves?: number | null;
};

export type PartState = "unknown" | "struggle" | "review" | "mastered";

/** Canonical ordering signal (mastery or partial struggle); null when unknown. */
export type OrderingSignal = number | null;

/** Qualified-complete mastery score; null when not qualified. */
export type MasteryResult = number | null;

export type AdaptivePartInput = {
  id: string;
  /** 1-based story position within the episode / curriculum. */
  order: number;
  /** Primary difficulty signal (0–100). Required for adaptive decisions. */
  difficultyScore: number | null;
  progress?: PartProgress | null;
  dueToday?: boolean;
  /**
   * Legacy enum label — retained for DB / logging only.
   * Not read by the adaptive engine.
   */
  difficulty?: "easy" | "medium" | "hard";
};

export type OrderingDiagnostics = {
  state: PartState;
  orderingSignal: OrderingSignal;
  masteryScore: MasteryResult;
};

export { clampScore as clamp };
