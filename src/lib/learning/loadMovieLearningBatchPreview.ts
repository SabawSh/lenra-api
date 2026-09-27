/**
 * Server loader: current learning batch clip cards for the movie sections page.
 * Reuses materialization + part progress; does not change Adaptive Teacher / merge.
 */
import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import { listSavedCardIdByClipForUserParts } from "@/lib/db/queries/savedVocabularyCards";
import {
  findMaterializedSectionHeader,
  listAtomicPartIdsBySectionIds,
} from "@/lib/db/queries/userMaterializedSections";
import {
  getEpisodePartsOrderMeta,
  getVideoPartsOrderMeta,
  hydrateSectionPartsFromOrderMeta,
} from "@/lib/db/parts";
import { fetchVideoScalarsById } from "@/lib/db/queries/videos";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import { pickFaOrFirstTranslation } from "@/lib/learning/partTranslationDisplay";
import {
  displayBatchCompletedCount,
  resolveBatchCtaMode,
  resolveContinueClip,
  withBatchProgress,
  type BatchCtaMode,
  type LearningBatchMapItem,
} from "@/lib/learning/learningBatchUi";
import {
  dedupeClipCardsByPartId,
  resolveBatchContinueClipIndex,
} from "@/lib/learning/batchClipDedupe";
import {
  buildBatchCompletionSummary,
  type BatchCompletionSummary,
} from "@/lib/learning/batchCompletionSummary";
import {
  buildMovieSectionPlayHref,
  buildSectionPlayHref,
  withBatchReviewPlayQuery,
} from "@/lib/learning/sectionResume";
import {
  resolveSectionDisplaySessionSlots,
} from "@/lib/learning/resolveLearnDisplaySession";
import type { SectionDisplayBuildResult } from "@/lib/learning/buildSectionDisplaySession";
import { mergeSectionDisplayPartIds } from "@/lib/learning/buildSectionDisplaySession";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { resolvePublicMediaUrl } from "@/lib/media/resolvePublicMediaUrl";
import {
  buildPlayableStepByPartId,
  isComposedBatchItemComplete,
} from "@/lib/learning/composedBatchProgress";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import type { UserId } from "@/types/schema";
import type { VideoDifficultyMix } from "@/lib/learning/videoDifficultyMix";

export type LearningClipCardState = "new" | "review" | "completed";

export type LearningBatchClipCard = {
  partId: string;
  clipIndex: number;
  englishText: string;
  translationText: string | null;
  /** Pipeline thumbnail when present. */
  thumbnailUrl: string | null;
  /** HLS relative path for first-frame preview when thumbnail is missing. */
  hlsManifestUrl: string | null;
  /** MP4 path/URL for first-frame preview when thumbnail is missing. */
  videoUrl: string | null;
  /** Movie cover used only if first-frame capture fails. */
  coverFallbackUrl: string | null;
  state: LearningClipCardState;
  /** Composed session slot — authoritative for review vs new in this batch. */
  displayKind?: "new" | "review";
  /** Qualified complete from part progress (independent of review/saved). */
  completed: boolean;
  /** Review slot completed today (for sidebar/batch review tick). */
  reviewedToday?: boolean;
  saved: boolean;
  /** Primary saved_vocabulary_cards row id when saved (for unsave). */
  savedCardId: number | null;
  /** Direct learn href for this step (optional; primary CTA uses batch continue). */
  playHref: string | null;
};

export type MovieLearningBatchPreview = {
  hero: {
    title: string;
    coverUrl: string | null;
    levels: string[];
    releaseYear: number | null;
    durationMs: number | null;
    description: string | null;
  };
  difficultyMix: VideoDifficultyMix | null;
  currentBatch: LearningBatchMapItem | null;
  clips: LearningBatchClipCard[];
  continueHref: string | null;
  continueClipIndex: number;
  totalCount: number;
  completedCount: number;
  ctaMode: BatchCtaMode;
  /**
   * Present only when this specific batch is fully completed.
   * Never reused across batch selection.
   */
  completionSummary: BatchCompletionSummary | null;
};

export type LearningBatchPreviewSeries = {
  seasonId: string;
  episodeId: string;
};

/** First-paint hero + empty clip list. Clips load via /batch-preview. */
export function shellMovieLearningBatchPreview(params: {
  title: string;
  coverUrl: string | null;
  levels: string[];
  releaseAt?: Date | string | null;
  durationMs: number | null;
  description: string | null;
  currentBatch: LearningBatchMapItem | null;
  difficultyMix?: VideoDifficultyMix | null;
}): MovieLearningBatchPreview {
  const batch = params.currentBatch;
  const completedCount = batch ? displayBatchCompletedCount(batch) : 0;
  const totalCount = batch?.clipCount ?? 0;
  return {
    hero: {
      title: params.title,
      coverUrl: params.coverUrl
        ? resolvePublicMediaUrl(params.coverUrl)
        : null,
      levels: params.levels,
      releaseYear: params.releaseAt
        ? new Date(params.releaseAt).getFullYear()
        : null,
      durationMs: params.durationMs,
      description: params.description?.trim() || null,
    },
    difficultyMix: params.difficultyMix ?? null,
    currentBatch: batch,
    clips: [],
    continueHref: batch?.playHref ?? null,
    continueClipIndex: batch
      ? resolveContinueClip(batch.startPart, batch.clipCount)
      : 1,
    completedCount,
    totalCount,
    ctaMode: batch ? resolveBatchCtaMode(batch) : "start",
    completionSummary: null,
  };
}

/**
 * Resolve part ids for a batch preview without Adaptive Teacher / unlock catalog.
 * Prefer the learner's materialized blueprint; otherwise use catalog order slice.
 */
type BatchPreviewPartsResult = {
  partIds: string[];
  displayBuild?: SectionDisplayBuildResult;
};

async function resolveBatchPreviewParts(params: {
  videoId: string;
  episodeId: string | null;
  userId: UserId | null;
  adaptiveUser: AdaptiveOrderUser | null;
  totalParts: number;
  sectionIndex: number;
}): Promise<BatchPreviewPartsResult> {
  const curriculumId = params.episodeId
    ? `episode:${params.episodeId}`
    : `video:${params.videoId}`;

  if (params.userId && params.adaptiveUser) {
    const curriculumParts = params.episodeId
      ? await getEpisodePartsOrderMeta(params.episodeId)
      : await getVideoPartsOrderMeta(params.videoId);
    const displayBuild = await resolveSectionDisplaySessionSlots({
      userId: params.userId,
      videoId: params.videoId,
      episodeId: params.episodeId,
      sectionIndex: params.sectionIndex,
      curriculumId,
      curriculumParts,
      user: params.adaptiveUser,
      totalParts: params.totalParts,
    });
    const partIds = mergeSectionDisplayPartIds(displayBuild);
    if (partIds.length > 0) {
      return { partIds, displayBuild };
    }
  }

  if (params.userId) {
    const header = await findMaterializedSectionHeader({
      userId: params.userId,
      videoId: params.videoId,
      episodeId: params.episodeId,
      scopeKey: curriculumId,
      sectionIndex: params.sectionIndex,
    });
    if (header) {
      const bySection = await listAtomicPartIdsBySectionIds([header.id]);
      const ids = (bySection.get(header.id) ?? []).slice(
        0,
        VISIBLE_UNITS_PER_SECTION,
      );
      if (ids.length > 0) return { partIds: ids };
    }
  }

  const meta = params.episodeId
    ? await getEpisodePartsOrderMeta(params.episodeId)
    : await getVideoPartsOrderMeta(params.videoId);
  const start = (params.sectionIndex - 1) * VISIBLE_UNITS_PER_SECTION;
  return {
    partIds: meta
      .slice(start, start + VISIBLE_UNITS_PER_SECTION)
      .map((p) => p.id),
  };
}

function batchPlayHref(
  params: {
    videoId: string;
    learnType?: "movie" | "documentary";
    series?: LearningBatchPreviewSeries | null;
  },
  sectionIndex: number,
  startStep: number,
): string | null {
  if (params.series) {
    return buildSectionPlayHref(
      true,
      params.videoId,
      params.series.seasonId,
      params.series.episodeId,
      sectionIndex,
      startStep,
    );
  }
  return buildMovieSectionPlayHref(
    true,
    params.learnType ?? "movie",
    params.videoId,
    sectionIndex,
    startStep,
  );
}

export async function loadMovieLearningBatchPreview(params: {
  videoId: string;
  learnType?: "movie" | "documentary";
  series?: LearningBatchPreviewSeries | null;
  userId: UserId | null;
  adaptiveUser: AdaptiveOrderUser | null;
  totalParts: number;
  currentBatch: LearningBatchMapItem | null;
  difficultyMix: VideoDifficultyMix | null;
  /** Skip a second videos-row fetch when the page already loaded it. */
  video?: {
    name: string;
    coverUrl: string | null;
    levels: string[];
    releaseAt: Date | string | null;
    durationMs: number | null;
    description: string | null;
  } | null;
}): Promise<MovieLearningBatchPreview> {
  const video =
    params.video !== undefined
      ? params.video
      : await fetchVideoScalarsById(params.videoId);
  const hero = {
    title: video?.name ?? "",
    coverUrl: video?.coverUrl
      ? resolvePublicMediaUrl(video.coverUrl)
      : null,
    levels: video?.levels ?? [],
    releaseYear: video?.releaseAt
      ? new Date(video.releaseAt).getFullYear()
      : null,
    durationMs: video?.durationMs ?? null,
    description: video?.description?.trim() || null,
  };

  const batch = params.currentBatch;
  if (!batch || batch.clipCount < 1) {
    return {
      hero,
      difficultyMix: params.difficultyMix,
      currentBatch: batch,
      clips: [],
      continueHref: batch?.playHref ?? null,
      continueClipIndex: 1,
      completedCount: 0,
      totalCount: 0,
      ctaMode: "start",
      completionSummary: null,
    };
  }

  const episodeId = params.series?.episodeId ?? null;
  const { partIds, displayBuild } = await resolveBatchPreviewParts({
    videoId: params.videoId,
    episodeId,
    userId: params.userId,
    adaptiveUser: params.adaptiveUser,
    totalParts: params.totalParts,
    sectionIndex: batch.sectionIndex,
  });
  const hydratedRaw = await hydrateSectionPartsFromOrderMeta(
    partIds.map((id) => ({ id })),
  );
  const byId = new Map(hydratedRaw.map((p) => [p.id, p]));
  const [progressSlices, savedByClip] = await Promise.all([
    params.userId && partIds.length > 0
      ? listProgressSliceForParts(params.userId, partIds)
      : Promise.resolve([]),
    params.userId && partIds.length > 0
      ? listSavedCardIdByClipForUserParts(params.userId, partIds)
      : Promise.resolve(new Map<string, number>()),
  ]);

  const progressById = new Map(
    progressSlices.map((s) => [
      s.partId,
      {
        bestScore: s.bestScore,
        lastScore: s.lastScore,
        completedAt: s.completedAt,
        attempts: s.attempts,
        wrongMoves: s.wrongMoves,
        accuracy: s.accuracy,
        speed: s.speed,
        lastSentenceInputMode: s.lastSentenceInputMode,
        sessionSectionIndex: s.sessionSectionIndex,
        visibleUnitStep: s.visibleUnitStep,
        xpEarned: s.xpEarned,
      },
    ]),
  );

  const playableStepByPartId = displayBuild
    ? buildPlayableStepByPartId(displayBuild.displaySlots)
    : new Map<string, number>();

  const completedPartIds = new Set(
    displayBuild?.completedSlots.flatMap((s) => s.unit.parts.map((p) => p.id)) ??
      [],
  );
  const displayKindByPartId = new Map<string, "new" | "review" | "completed">();
  if (displayBuild) {
    for (const slot of displayBuild.displaySlots) {
      const id = slot.unit.parts[0]?.id;
      if (!id) continue;
      displayKindByPartId.set(id, slot.displayKind);
    }
  }

  const clipsRaw: LearningBatchClipCard[] = [];
  for (let i = 0; i < partIds.length; i++) {
    const partId = partIds[i]!;
    const part = byId.get(partId);
    if (!part) continue;
    const clipIndex = i + 1;
    const progress = progressById.get(partId) ?? null;
    const composedKind = displayKindByPartId.get(partId);
    const displayKind =
      composedKind === "completed" ? undefined : composedKind;
    const inCompositionCompleted = completedPartIds.has(partId);
    const completed = isComposedBatchItemComplete({
      inCompositionCompletedSet: inCompositionCompleted,
      displayKind,
      partId,
      batchSectionIndex: batch.sectionIndex,
      dueTodayPartIds: new Set<string>(),
      progress,
      playableStepByPartId,
    });
    const state: LearningClipCardState = completed ? "completed" : "new";

    const thumbRaw = part.thumbnailUrl?.trim() || null;
    const thumb = thumbRaw ? resolvePublicMediaUrl(thumbRaw) : null;
    const savedCardId = savedByClip.get(partId) ?? null;

    clipsRaw.push({
      partId,
      clipIndex,
      englishText: part.text?.trim() || `Clip ${clipIndex}`,
      translationText: pickFaOrFirstTranslation(part.translations),
      thumbnailUrl: thumb,
      hlsManifestUrl: null,
      videoUrl: null,
      coverFallbackUrl: hero.coverUrl,
      state,
      displayKind,
      completed,
      saved: savedCardId != null,
      savedCardId,
      playHref: batchPlayHref(params, batch.sectionIndex, clipIndex),
    });
  }

  // One row per canonical part_id (reminder + new-content must not double).
  let clips = dedupeClipCardsByPartId(clipsRaw).map((clip) => ({
    ...clip,
    playHref: batchPlayHref(params, batch.sectionIndex, clip.clipIndex),
  }));

  const completedCount = clips.filter((c) => c.completed).length;
  const totalCount = displayBuild?.displaySlots.length ?? clips.length;

  const continueClipIndex =
    completedCount >= totalCount && totalCount > 0
      ? 1
      : resolveBatchContinueClipIndex(
          clips,
          resolveContinueClip(batch.startPart, batch.clipCount),
        );

  const enrichedBatch = withBatchProgress(batch, {
    completedCount,
    clipCount: totalCount,
    startPart: continueClipIndex,
  });
  const ctaMode = resolveBatchCtaMode(enrichedBatch);
  if (ctaMode === "review") {
    clips = clips.map((clip) => ({
      ...clip,
      playHref: withBatchReviewPlayQuery(clip.playHref),
    }));
  }

  let continueHref = batchPlayHref(
    params,
    batch.sectionIndex,
    continueClipIndex,
  );
  if (ctaMode === "review") {
    continueHref = withBatchReviewPlayQuery(continueHref);
  }

  const completionSummary = buildBatchCompletionSummary({
    sectionIndex: batch.sectionIndex,
    clips,
    progressSlices,
  });

  return {
    hero,
    difficultyMix: params.difficultyMix,
    currentBatch: {
      ...enrichedBatch,
      playHref: continueHref,
    },
    clips,
    continueHref,
    continueClipIndex,
    completedCount,
    totalCount,
    ctaMode,
    completionSummary,
  };
}
