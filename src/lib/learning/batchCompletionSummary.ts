/**
 * Batch-scoped completion summary — derived only from existing part progress
 * and saved-card state. No invented metrics.
 */
import {
  CLIP_XP_MAX,
  clipXpAmount,
  clipXpContextFromStoredProgress,
} from "@/lib/gamification/clipXp";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";

export type BatchCompletionSummary = {
  /** Batch this summary belongs to (sectionIndex). */
  sectionIndex: number;
  completedCount: number;
  totalCount: number;
  /** XP derived from best-attempt metrics (same model as section summary). */
  sectionXp: number;
  maxSectionXp: number;
  /** Average bestScore across attempted clips in this batch (0–100). */
  avgBestScore: number;
  /** Clips in this batch with at least one saved_vocabulary_cards row. */
  savedVocabCount: number;
  /** Clips currently due for review (may still appear after full completion). */
  reviewDueCount: number;
};

/** Sidebar card shape derived only from a batch-scoped completion summary. */
export type RecentBatchSidebarCard = {
  sectionIndex: number;
  completedCount: number;
  totalCount: number;
  sectionXp: number | null;
  savedVocabCount: number | null;
  avgBestScore: number | null;
};

/**
 * Map completion summary → sidebar celebration card.
 * Returns null when the selected batch is incomplete.
 */
export function recentBatchFromCompletionSummary(
  summary: BatchCompletionSummary | null | undefined,
): RecentBatchSidebarCard | null {
  if (!summary) return null;
  return {
    sectionIndex: summary.sectionIndex,
    completedCount: summary.completedCount,
    totalCount: summary.totalCount,
    sectionXp: summary.sectionXp,
    savedVocabCount: summary.savedVocabCount,
    avgBestScore: summary.avgBestScore,
  };
}

type ProgressSlice = {
  partId: string;
  bestScore: number;
  completedAt: Date | null;
  attempts: number;
  wrongMoves: number;
  accuracy?: number | null;
  speed?: number | null;
  lastSentenceInputMode?: "drag" | "voice" | null;
};

type ClipRef = {
  partId: string;
  completed: boolean;
  saved: boolean;
  state: "new" | "review" | "completed";
};

/**
 * Build a completion summary for a fully completed batch.
 * Returns null when the batch is incomplete — callers must not show celebration UI.
 */
export function buildBatchCompletionSummary(params: {
  sectionIndex: number;
  clips: readonly ClipRef[];
  progressSlices: readonly ProgressSlice[];
}): BatchCompletionSummary | null {
  const totalCount = params.clips.length;
  if (totalCount < 1) return null;

  const completedCount = params.clips.filter((c) => c.completed).length;
  if (completedCount < totalCount) return null;

  const progressById = new Map(
    params.progressSlices.map((s) => [s.partId, s]),
  );

  let xpSum = 0;
  let scoreSum = 0;
  let scoreN = 0;

  for (const clip of params.clips) {
    const row = progressById.get(clip.partId);
    if (!row || !isQualifiedComplete(row)) continue;

    const inputMode = row.lastSentenceInputMode ?? null;
    xpSum += clipXpAmount(
      inputMode ?? undefined,
      clipXpContextFromStoredProgress({
        inputMode,
        bestScore: row.bestScore,
        wrongMoves: row.wrongMoves,
        accuracy: row.accuracy ?? null,
        speed: row.speed ?? null,
      }),
    );
    scoreSum += row.bestScore;
    scoreN += 1;
  }

  return {
    sectionIndex: params.sectionIndex,
    completedCount,
    totalCount,
    sectionXp: xpSum,
    maxSectionXp: totalCount * CLIP_XP_MAX,
    avgBestScore: scoreN > 0 ? Math.round(scoreSum / scoreN) : 0,
    savedVocabCount: params.clips.filter((c) => c.saved).length,
    reviewDueCount: params.clips.filter((c) => c.state === "review").length,
  };
}
