import { devUnlockAllLearningBatches } from "@/lib/learning/devBatchUnlock";
import {
  batchIsComplete,
  type LearningBatchMapItem,
} from "@/lib/learning/learningBatchUi";

/** @deprecated Prefer {@link devUnlockAllLearningBatches}. */
export function bypassSequentialBatchLockInDev(): boolean {
  return devUnlockAllLearningBatches();
}

/** Batch N is available only after batch N−1 is fully complete (batch 1 always open). */
export function applySequentialBatchUnlock(
  batches: readonly LearningBatchMapItem[],
  options?: {
    /** Completion state of the section immediately before the first row (for paginated pages). */
    priorBatchComplete?: boolean;
  },
): LearningBatchMapItem[] {
  const sorted = [...batches].sort(
    (a, b) => a.sectionIndex - b.sectionIndex,
  );
  if (bypassSequentialBatchLockInDev()) {
    return sorted.map((batch) => ({ ...batch, unlocked: true }));
  }
  let previousBatchComplete = options?.priorBatchComplete ?? true;

  return sorted.map((batch) => {
    const unlocked = batch.sectionIndex <= 1 || previousBatchComplete;
    previousBatchComplete = batchIsComplete(batch);
    return {
      ...batch,
      unlocked,
    };
  });
}
