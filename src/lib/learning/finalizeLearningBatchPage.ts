import { isSectionBatchComplete } from "@/lib/learning/enrichBatchesWithPartProgress";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import {
  batchIsComplete,
  continueStepForBatch,
  type LearningBatchMapItem,
} from "@/lib/learning/learningBatchUi";
import { withBatchReviewPlayQuery } from "@/lib/learning/sectionResume";
import { applySequentialBatchUnlock } from "@/lib/learning/sequentialBatchUnlock";
import type { UserId } from "@/types/schema";

/** Apply sequential unlock + play hrefs after part-progress enrichment. */
export async function finalizeLearningBatchPage(params: {
  enriched: LearningBatchMapItem[];
  userId: UserId | null;
  videoId: string;
  episodeId?: string | null;
  totalParts: number;
  adaptiveUser: AdaptiveOrderUser | null;
  buildPlayHref: (
    row: LearningBatchMapItem,
    startStep: number,
  ) => string | null;
}): Promise<LearningBatchMapItem[]> {
  if (params.enriched.length === 0) return [];

  const firstSectionIndex = params.enriched[0]!.sectionIndex;
  const priorBatchComplete =
    firstSectionIndex <= 1
      ? true
      : await isSectionBatchComplete({
          userId: params.userId,
          videoId: params.videoId,
          episodeId: params.episodeId,
          sectionIndex: firstSectionIndex - 1,
          totalParts: params.totalParts,
          adaptiveUser: params.adaptiveUser,
        });

  const withUnlock = applySequentialBatchUnlock(params.enriched, {
    priorBatchComplete,
  });

  return withUnlock.map((row) => {
    const step = continueStepForBatch(row);
    const baseHref = row.unlocked ? params.buildPlayHref(row, step) : null;
    const playHref =
      baseHref && batchIsComplete(row)
        ? withBatchReviewPlayQuery(baseHref)
        : baseHref;
    return {
      ...row,
      startPart: step,
      playHref,
    };
  });
}
