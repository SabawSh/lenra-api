import {
  buildSectionDisplaySession,
  mergeSectionDisplayPartIds,
  type SectionDisplayBuildResult,
  type SectionDisplaySlot,
  type SectionSessionSlot,
} from "@/lib/learning/buildSectionDisplaySession";
import { SECTION_DISPLAY_CAPACITY } from "@/lib/learning/sectionDisplayComposition";
import {
  getOrMaterializeProgressionSection,
  hydrateVisibleSectionUnits,
  loadVisibleSectionCatalog,
} from "@/lib/learning/sectionCurriculum";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import type { EpisodePartForAdaptiveOrder } from "@/lib/learning/adaptiveEpisodeOrdering";
import type { LearningUnit } from "@/lib/skill-engine/learning-units/types";
import type { Part } from "@/types/video";
import type { UserId } from "@/types/schema";
import type { BuildSectionLearningUnitsOptions } from "@/lib/learning/buildSectionLearningUnits";
import { getAdaptiveEpisodeOrder } from "@/lib/learning/adaptiveEpisodeOrdering";
import {
  playableDisplaySlotsFromComposed,
  sessionSlotsForBatchReview,
} from "@/lib/learning/sectionDisplaySessionState";

export type LearnDisplaySessionResult = {
  /** Full composed batch (≤10) — progress / summary source of truth. */
  composedDisplaySlots: SectionDisplaySlot[];
  /** Play playlist: composed order with completed removed. Index-aligned with `learningUnits`. */
  displaySlots: SectionSessionSlot[];
  sessionSlots: SectionSessionSlot[];
  learningUnits: LearningUnit<Part>[];
  visibleStepCount: number;
  /** Full composed batch replay (`?batchReview=1`). */
  batchReview?: boolean;
};

/**
 * Compose up to 10 normal learning display slots for a section.
 * Returns null for guests or review-mode queue so callers keep the legacy playlist.
 */
export async function resolveLearnDisplaySession(params: {
  userId: UserId | null;
  videoId: string;
  episodeId?: string | null;
  sectionIndex: number;
  globalOrder: readonly EpisodePartForAdaptiveOrder[];
  user: AdaptiveOrderUser | null;
  buildOptions?: BuildSectionLearningUnitsOptions;
  progressionUnits: ReadonlyArray<LearningUnit<Part>>;
  reviewMode?: boolean;
  batchReviewMode?: boolean;
}): Promise<LearnDisplaySessionResult | null> {
  if (!params.userId || params.reviewMode) return null;

  const catalogEntries = await loadVisibleSectionCatalog(
    params.globalOrder,
    params.user,
    params.buildOptions,
    { sectionLimit: params.sectionIndex },
  );

  const build = await buildSectionDisplaySession({
    catalogEntries,
    targetSectionIndex: params.sectionIndex,
    userId: params.userId,
    targetProgressionUnits: params.progressionUnits,
  });

  if (build.displaySlots.length === 0) {
    return null;
  }

  const composedDisplaySlots = build.displaySlots;
  const batchReview = params.batchReviewMode === true;
  const playableSlots = batchReview
    ? sessionSlotsForBatchReview(composedDisplaySlots)
    : playableDisplaySlotsFromComposed(composedDisplaySlots);
  const learningUnits = playableSlots.map((s) => s.unit);
  const visibleStepCount = batchReview
    ? Math.min(SECTION_DISPLAY_CAPACITY, composedDisplaySlots.length)
    : Math.min(SECTION_DISPLAY_CAPACITY, playableSlots.length);

  return {
    composedDisplaySlots,
    displaySlots: playableSlots,
    sessionSlots: playableSlots,
    learningUnits,
    visibleStepCount,
    batchReview,
  };
}

/** Composed display slots for a section (logged-in learners). */
export async function resolveSectionDisplaySessionSlots(params: {
  userId: UserId;
  videoId: string;
  episodeId: string | null;
  sectionIndex: number;
  curriculumId: string;
  curriculumParts: readonly EpisodePartForAdaptiveOrder[];
  user: AdaptiveOrderUser;
  totalParts: number;
}): Promise<SectionDisplayBuildResult> {
  const globalOrder = await getAdaptiveEpisodeOrder({
    episodeParts: params.curriculumParts,
    user: params.user,
    context: { curriculumId: params.curriculumId, totalParts: params.totalParts },
  });
  const buildOptions: BuildSectionLearningUnitsOptions = {
    forceAtomicUnits: true,
    sectionIndex: params.sectionIndex,
    sectionId: `${params.curriculumId}:section:${params.sectionIndex}`,
  };
  const catalogEntries = await loadVisibleSectionCatalog(
    globalOrder,
    params.user,
    buildOptions,
    { sectionLimit: params.sectionIndex },
  );
  const curriculumId = params.curriculumId;
  const playlist = await getOrMaterializeProgressionSection({
    progressionScope: params.episodeId
      ? {
          scope: { episodeId: params.episodeId, curriculumId },
          videoId: params.videoId,
          episodeId: params.episodeId,
        }
      : {
          scope: { videoId: params.videoId, curriculumId },
          videoId: params.videoId,
          episodeId: null,
        },
    sectionIndex: params.sectionIndex,
    user: params.user,
    totalParts: params.totalParts,
    mode: "get-or-create",
    options: buildOptions,
  });
  const { progressionUnits } = await hydrateVisibleSectionUnits(playlist);
  if (progressionUnits.length === 0 && catalogEntries.length === 0) {
    return { displaySlots: [], completedSlots: [], sessionSlots: [] };
  }

  return buildSectionDisplaySession({
    catalogEntries,
    targetSectionIndex: params.sectionIndex,
    userId: params.userId,
    targetProgressionUnits: progressionUnits,
  });
}

/** Part ids in display order for batch preview (logged-in learners). */
export async function resolveSectionDisplayPartIds(params: {
  userId: UserId;
  videoId: string;
  episodeId: string | null;
  sectionIndex: number;
  curriculumId: string;
  curriculumParts: readonly EpisodePartForAdaptiveOrder[];
  user: AdaptiveOrderUser;
  totalParts: number;
}): Promise<string[]> {
  const build = await resolveSectionDisplaySessionSlots(params);
  return mergeSectionDisplayPartIds(build);
}
