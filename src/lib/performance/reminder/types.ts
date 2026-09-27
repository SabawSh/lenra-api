/** Allowed review intervals (days). Same-day = 0. */
export const REMINDER_INTERVAL_DAYS = [
  0, 1, 2, 3, 5, 7, 14, 21, 30, 45, 60, 90,
] as const;

/** Hard ceiling — never schedule farther than this. */
export const MAX_REMINDER_DAYS = 90;

/**
 * Learner struggle signals only — never clip/sentence difficulty metadata.
 * Extend with hesitation, fuzzy match, speech confidence, etc.
 */
export type ReminderSchedulingContext = {
  /** Clip attempts before this completion (1 = first try). */
  attempts?: number;
  videoDurationMs?: number;
  /** Puzzle chunks in the clip (for slow-solve detection). */
  chunkCount?: number;
  /**
   * Last scheduled interval for this part (days), inferred from the
   * existing reminder row. Used to grow spacing after a clean review.
   */
  previousIntervalDays?: number | null;
};
