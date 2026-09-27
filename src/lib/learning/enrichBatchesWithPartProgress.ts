/**
 * Attach canonical per-part completed counts onto learning batches.
 * Do not use resume `startPart` as a completion proxy.
 *
 * One materialized-parts + progress query for the whole page.
 * Batches without a stored blueprint stay at 0 / catalog clipCount —
 * do not rematerialize the grid on the sections page.
 */
import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import {
  listAtomicPartIdsBySectionIds,
  listMaterializedSectionHeaders,
} from "@/lib/db/queries/userMaterializedSections";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import { firstIncompleteCanonicalStep } from "@/lib/learning/batchProgression";
import {
  batchIsComplete,
  withBatchProgress,
  type LearningBatchMapItem,
} from "@/lib/learning/learningBatchUi";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import type { UserId } from "@/types/schema";

function progressionScopeForBatches(params: {
  videoId: string;
  episodeId?: string | null;
}): {
  curriculumId: string;
  episodeId: string | null;
  progressionScope: {
    scope:
      | { videoId: string; curriculumId: string }
      | { episodeId: string; curriculumId: string };
    videoId: string;
    episodeId: string | null;
  };
} {
  if (params.episodeId) {
    const curriculumId = `episode:${params.episodeId}`;
    return {
      curriculumId,
      episodeId: params.episodeId,
      progressionScope: {
        scope: { episodeId: params.episodeId, curriculumId },
        videoId: params.videoId,
        episodeId: params.episodeId,
      },
    };
  }
  const curriculumId = `video:${params.videoId}`;
  return {
    curriculumId,
    episodeId: null,
    progressionScope: {
      scope: { videoId: params.videoId, curriculumId },
      videoId: params.videoId,
      episodeId: null,
    },
  };
}

function countQualified(
  partIds: readonly string[],
  slices: Awaited<ReturnType<typeof listProgressSliceForParts>>,
): number {
  const byId = new Map(slices.map((s) => [s.partId, s]));
  let completedCount = 0;
  for (const id of partIds) {
    const row = byId.get(id);
    if (
      isQualifiedComplete(
        row
          ? {
              bestScore: row.bestScore,
              completedAt: row.completedAt,
              attempts: row.attempts,
              wrongMoves: row.wrongMoves,
            }
          : null,
      )
    ) {
      completedCount += 1;
    }
  }
  return completedCount;
}

function applyProgress(
  batch: LearningBatchMapItem,
  completedCount: number,
  clipCount: number,
  partIds: readonly string[],
  slices: Awaited<ReturnType<typeof listProgressSliceForParts>>,
): LearningBatchMapItem {
  const progressByPartId = new Map(slices.map((s) => [s.partId, s] as const));
  const firstOpen = firstIncompleteCanonicalStep(partIds, progressByPartId);
  const startPart =
    firstOpen != null
      ? firstOpen
      : completedCount >= clipCount
        ? 1
        : Math.min(clipCount, Math.max(1, completedCount + 1));

  return withBatchProgress(batch, {
    completedCount,
    clipCount: batch.clipCount > 0 ? batch.clipCount : clipCount,
    startPart,
  });
}

/** Enrich a page of batches with part-progress completed counts. */
export async function enrichBatchesWithPartProgress(params: {
  userId: UserId | null;
  videoId: string;
  episodeId?: string | null;
  totalParts: number;
  adaptiveUser: AdaptiveOrderUser | null;
  batches: LearningBatchMapItem[];
}): Promise<LearningBatchMapItem[]> {
  if (params.batches.length === 0) return [];

  const partIdsBySection = new Map<number, string[]>();
  const { episodeId, curriculumId } = progressionScopeForBatches(params);

  if (params.userId) {
    const headers = await listMaterializedSectionHeaders({
      userId: params.userId,
      videoId: params.videoId,
      episodeId,
      scopeKey: curriculumId,
    });
    const wanted = new Set(params.batches.map((b) => b.sectionIndex));
    const pageHeaders = headers.filter((h) => wanted.has(h.sectionIndex));
    const atomicBySectionId = await listAtomicPartIdsBySectionIds(
      pageHeaders.map((h) => h.id),
    );
    for (const header of pageHeaders) {
      const ids = (atomicBySectionId.get(header.id) ?? []).slice(
        0,
        VISIBLE_UNITS_PER_SECTION,
      );
      if (ids.length > 0) partIdsBySection.set(header.sectionIndex, ids);
    }
  }

  const allPartIds = [...new Set([...partIdsBySection.values()].flat())];
  const slices =
    params.userId && allPartIds.length > 0
      ? await listProgressSliceForParts(params.userId, allPartIds)
      : [];

  return params.batches.map((batch) => {
    const partIds = partIdsBySection.get(batch.sectionIndex);
    if (partIds) {
      return applyProgress(
        batch,
        countQualified(partIds, slices),
        partIds.length || batch.clipCount || VISIBLE_UNITS_PER_SECTION,
        partIds,
        slices,
      );
    }
    return withBatchProgress(batch, {
      completedCount: 0,
      clipCount: batch.clipCount || VISIBLE_UNITS_PER_SECTION,
    });
  });
}

/** Whether every clip in a single batch section is qualified-complete. */
export async function isSectionBatchComplete(params: {
  userId: UserId | null;
  videoId: string;
  episodeId?: string | null;
  sectionIndex: number;
  totalParts: number;
  adaptiveUser: AdaptiveOrderUser | null;
}): Promise<boolean> {
  if (params.sectionIndex < 1) return true;
  const shell: LearningBatchMapItem = {
    sectionIndex: params.sectionIndex,
    clipCount: VISIBLE_UNITS_PER_SECTION,
    unlocked: true,
    playHref: null,
    firstClipUrl: null,
  };
  const [row] = await enrichBatchesWithPartProgress({
    userId: params.userId,
    videoId: params.videoId,
    episodeId: params.episodeId,
    totalParts: params.totalParts,
    adaptiveUser: params.adaptiveUser,
    batches: [shell],
  });
  return row != null && batchIsComplete(row);
}

/** @deprecated Import from `@/lib/learning/learningBatchUi` (client-safe). */
export { continueStepForBatch } from "@/lib/learning/learningBatchUi";
