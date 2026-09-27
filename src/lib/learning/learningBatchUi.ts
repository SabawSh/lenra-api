/**
 * Learner-facing Learning Batch helpers.
 * Internally batches still map 1:1 to sectionIndex / materialized sections.
 *
 * Completion display MUST prefer `completedCount` from canonical part progress.
 * Resume `startPart` is only a fallback when progress has not been enriched.
 */

import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";

export type LearningBatchMapItem = {
  /** Internal section index (persistence / routes). Not shown as "Section N". */
  sectionIndex: number;
  clipCount: number;
  unlocked: boolean;
  playHref: string | null;
  /** 1-based first incomplete clip (resume), or 1. */
  startPart?: number;
  firstClipUrl: string | null;
  /**
   * Qualified-complete clip count from `user_part_progress` / part_id.
   * When set, this is the source of truth for progress UI.
   */
  completedCount?: number;
};

/** Attach part-progress fields onto a batch map item. */
export function withBatchProgress(
  batch: LearningBatchMapItem,
  progress: { completedCount: number; clipCount?: number; startPart?: number },
): LearningBatchMapItem {
  return {
    ...batch,
    completedCount: Math.max(0, progress.completedCount),
    clipCount:
      progress.clipCount != null && progress.clipCount > 0
        ? progress.clipCount
        : batch.clipCount,
    startPart: progress.startPart ?? batch.startPart,
  };
}

/**
 * @deprecated Prefer {@link displayBatchCompletedCount} with enriched batches.
 * Resume-position proxy: completed ≈ everything before the continue step.
 */
export function batchCompletedCountFromResume(
  startPart: number | null | undefined,
  clipCount: number = VISIBLE_UNITS_PER_SECTION,
): number {
  const total = Math.max(0, clipCount);
  if (total === 0) return 0;
  const start = Math.max(1, startPart ?? 1);
  if (start > total) return total;
  return Math.min(total, Math.max(0, start - 1));
}

/**
 * Display completed count for a batch.
 * Prefer canonical `completedCount`; fall back to resume proxy only when missing.
 */
export function displayBatchCompletedCount(
  batch: Pick<LearningBatchMapItem, "completedCount" | "startPart" | "clipCount">,
): number {
  const total = Math.max(0, batch.clipCount);
  if (typeof batch.completedCount === "number") {
    return Math.min(total, Math.max(0, batch.completedCount));
  }
  return batchCompletedCountFromResume(batch.startPart, total);
}

/** @deprecated Use {@link displayBatchCompletedCount}. */
export function batchCompletedCount(
  startPartOrBatch: number | null | undefined | LearningBatchMapItem,
  clipCount: number = VISIBLE_UNITS_PER_SECTION,
): number {
  if (startPartOrBatch != null && typeof startPartOrBatch === "object") {
    return displayBatchCompletedCount(startPartOrBatch);
  }
  return batchCompletedCountFromResume(startPartOrBatch, clipCount);
}

export function batchIsComplete(
  batchOrStart:
    | number
    | null
    | undefined
    | Pick<LearningBatchMapItem, "completedCount" | "startPart" | "clipCount">,
  clipCount: number = VISIBLE_UNITS_PER_SECTION,
): boolean {
  if (batchOrStart != null && typeof batchOrStart === "object") {
    const total = Math.max(0, batchOrStart.clipCount);
    if (total === 0) return false;
    return displayBatchCompletedCount(batchOrStart) >= total;
  }
  return (
    batchCompletedCountFromResume(batchOrStart, clipCount) >=
    Math.max(0, clipCount)
  );
}

/** First incomplete clip index (1-based) for Continue. */
export function resolveContinueClip(
  startPart: number | null | undefined,
  clipCount: number = VISIBLE_UNITS_PER_SECTION,
): number {
  const total = Math.max(1, clipCount);
  const start = Math.max(1, startPart ?? 1);
  if (start > total) return 1;
  return Math.min(start, total);
}

/** 1-based step for play / continue links on an enriched batch row. */
export function continueStepForBatch(batch: LearningBatchMapItem): number {
  if (batchIsComplete(batch)) {
    return 1;
  }
  const total = Math.max(1, batch.clipCount);
  if (
    typeof batch.startPart === "number" &&
    batch.startPart >= 1 &&
    batch.startPart <= total
  ) {
    return batch.startPart;
  }
  if (typeof batch.completedCount === "number") {
    return Math.min(Math.max(1, batch.completedCount + 1), total);
  }
  return resolveContinueClip(batch.startPart, batch.clipCount);
}

export type BatchCtaMode = "start" | "continue" | "review";

export function resolveBatchCtaMode(
  batch: Pick<LearningBatchMapItem, "completedCount" | "startPart" | "clipCount">,
): BatchCtaMode {
  const completed = displayBatchCompletedCount(batch);
  const total = Math.max(0, batch.clipCount);
  if (total > 0 && completed >= total) return "review";
  if (completed > 0) return "continue";
  return "start";
}

/**
 * Pick the batch the learner should Continue into:
 * incomplete resume → first in-progress → first fresh → last available (review).
 *
 * Never opens a fully completed batch as the primary entry when a later
 * incomplete batch exists.
 */
export function pickCurrentBatch(
  batches: readonly LearningBatchMapItem[],
  resumeSectionIndex?: number | null,
): LearningBatchMapItem | null {
  if (batches.length === 0) return null;

  if (resumeSectionIndex != null) {
    const resume = batches.find((b) => b.sectionIndex === resumeSectionIndex);
    if (resume?.playHref && !batchIsComplete(resume)) return resume;
  }

  const incompleteWithProgress = batches.find(
    (b) =>
      b.playHref &&
      !batchIsComplete(b) &&
      displayBatchCompletedCount(b) > 0,
  );
  if (incompleteWithProgress) return incompleteWithProgress;

  const fresh = batches.find((b) => b.playHref && !batchIsComplete(b));
  if (fresh) return fresh;

  return batches.find((b) => b.playHref) ?? batches[0] ?? null;
}

/**
 * Next incomplete batch after `fromSectionIndex` (for Continue after completion).
 * Falls back to the first incomplete batch earlier in the list, then null.
 */
export function pickNextIncompleteBatch(
  batches: readonly LearningBatchMapItem[],
  fromSectionIndex: number,
): LearningBatchMapItem | null {
  const after = batches.find(
    (b) =>
      b.sectionIndex > fromSectionIndex &&
      b.playHref &&
      !batchIsComplete(b),
  );
  if (after) return after;
  return (
    batches.find((b) => b.playHref && !batchIsComplete(b)) ?? null
  );
}

/** Row model for the in-batch clip list (no difficulty fields). */
export type BatchClipRow = {
  clipIndex: number;
  status: "completed" | "current" | "upcoming";
};

export function buildBatchClipRows(
  startPartOrBatch:
    | number
    | null
    | undefined
    | Pick<LearningBatchMapItem, "completedCount" | "startPart" | "clipCount">,
  clipCount: number = VISIBLE_UNITS_PER_SECTION,
): BatchClipRow[] {
  if (startPartOrBatch != null && typeof startPartOrBatch === "object") {
    const total = Math.max(0, startPartOrBatch.clipCount);
    const completed = displayBatchCompletedCount(startPartOrBatch);
    const resumeStep = startPartOrBatch.startPart;
    const continueAt =
      completed >= total
        ? 1
        : resumeStep != null && resumeStep >= 1 && resumeStep <= total
          ? resumeStep
          : Math.min(total, Math.max(1, completed + 1));
    const rows: BatchClipRow[] = [];
    for (let i = 1; i <= total; i++) {
      let status: BatchClipRow["status"] = "upcoming";
      if (completed >= total) {
        status = "completed";
      } else if (i === continueAt) {
        status = "current";
      } else if (resumeStep != null && i < resumeStep) {
        status = "completed";
      } else if (resumeStep == null && i <= completed) {
        status = "completed";
      }
      rows.push({ clipIndex: i, status });
    }
    return rows;
  }

  const total = Math.max(0, clipCount);
  const continueAt = resolveContinueClip(startPartOrBatch, total);
  const completed = batchCompletedCountFromResume(startPartOrBatch, total);
  const rows: BatchClipRow[] = [];
  for (let i = 1; i <= total; i++) {
    let status: BatchClipRow["status"] = "upcoming";
    if (i <= completed) status = "completed";
    else if (i === continueAt && completed < total) status = "current";
    rows.push({ clipIndex: i, status });
  }
  return rows;
}

/** Guard: batch card view models must never carry learner-facing difficulty. */
export function assertNoCardDifficultyFields(card: Record<string, unknown>): void {
  const banned = [
    "difficulty",
    "difficultyScore",
    "contentDifficulty",
    "easy",
    "medium",
    "advanced",
    "hard",
    "cefr",
  ];
  for (const key of banned) {
    if (Object.prototype.hasOwnProperty.call(card, key)) {
      throw new Error(`batch card must not expose difficulty field: ${key}`);
    }
  }
}
