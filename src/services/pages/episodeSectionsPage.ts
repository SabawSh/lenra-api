import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { userCanAccessLearning } from "@/lib/payments/access";
import { getLearningResumePosition } from "@/lib/db/learningResume";
import * as videoQueries from "@/lib/db/queries/videos";
import {
  countPartsForEpisode,
  getEpisodeSectionUnlockRows,
} from "@/lib/db/sectionProgress";
import { enrichBatchesWithPartProgress } from "@/lib/learning/enrichBatchesWithPartProgress";
import { finalizeLearningBatchPage } from "@/lib/learning/finalizeLearningBatchPage";
import { EPISODE_SECTIONS_PAGE_BATCH } from "@/lib/learning/episodeSectionsBatch";
import {
  estimatedSectionCountFromParts,
  lastLoadedSectionIndex,
  sectionsMapHasMorePages,
} from "@/lib/learning/episodeSectionsShell";
import {
  continueStepForBatch,
  pickCurrentBatch,
} from "@/lib/learning/learningBatchUi";
import { shellMovieLearningBatchPreview } from "@/lib/learning/loadMovieLearningBatchPreview";
import { emptyMovieLearningSidebar } from "@/lib/learning/loadMovieLearningSidebar";
import {
  buildSectionPlayHref,
  resolveSectionStartStep,
} from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";

export type EpisodeSectionsResult =
  | { ok: false; reason: "not_found" | "wrong_type" | "learning_blocked" }
  | { ok: true; payload: Record<string, unknown> };

export async function buildEpisodeSectionsPage(
  id: string,
  seasonId: string,
  episodeId: string,
): Promise<EpisodeSectionsResult> {
  const user = await getCurrentUser().catch(() => null);
  if (user && !(await userCanAccessLearning(user))) {
    return { ok: false, reason: "learning_blocked" };
  }

  const [video, season, episode, totalParts, difficultyMix] = await Promise.all([
    videoQueries.fetchVideoScalarsById(id),
    videoQueries.fetchSeasonById(seasonId),
    videoQueries.fetchEpisodeById(episodeId),
    countPartsForEpisode(episodeId),
    videoQueries.countPartDifficultyForEpisodeId(episodeId),
  ]);

  if (!video || video.type !== "series") {
    return { ok: false, reason: "wrong_type" };
  }

  if (
    !season ||
    season.videoId !== id ||
    !episode ||
    episode.seasonId !== seasonId ||
    totalParts < 1
  ) {
    return { ok: false, reason: "not_found" };
  }

  const estimatedSectionCount = estimatedSectionCountFromParts(totalParts);

  const [resumePosition, unlockPage] = await Promise.all([
    user != null
      ? getLearningResumePosition({
          userId: user.id,
          videoId: id,
          episodeId,
        })
      : null,
    getEpisodeSectionUnlockRows({
      userId: user?.id ?? null,
      episodeId,
      videoId: id,
      totalParts,
      startSectionIndex: 1,
      sectionLimit: EPISODE_SECTIONS_PAGE_BATCH,
    }),
  ]);

  const adaptiveUser =
    user != null
      ? { id: user.id, englishLevel: user.englishLevel ?? null }
      : null;

  const shellSections = unlockPage.rows.map((row) => {
    const startPart = resolveSectionStartStep(
      row.sectionIndex,
      VISIBLE_UNITS_PER_SECTION,
      resumePosition,
    );
    return {
      sectionIndex: row.sectionIndex,
      clipCount: row.clipCount,
      unlocked: row.unlocked,
      startPart,
      playHref: buildSectionPlayHref(
        row.unlocked,
        id,
        seasonId,
        episodeId,
        row.sectionIndex,
        startPart,
      ),
      firstClipUrl: null as null,
    };
  });

  const initialSections = await enrichBatchesWithPartProgress({
    userId: user?.id ?? null,
    videoId: id,
    episodeId,
    totalParts,
    adaptiveUser,
    batches: shellSections,
  });

  const sectionsWithHref = await finalizeLearningBatchPage({
    enriched: initialSections,
    userId: user?.id ?? null,
    videoId: id,
    episodeId,
    totalParts,
    adaptiveUser,
    buildPlayHref: (row, step) =>
      buildSectionPlayHref(true, id, seasonId, episodeId, row.sectionIndex, step),
  });

  const hasMoreSections = sectionsMapHasMorePages({
    hasMoreFromCatalog: unlockPage.hasMoreSections,
    lastLoadedSectionIndex: lastLoadedSectionIndex(sectionsWithHref),
    estimatedSectionCount,
  });

  const currentBatch = pickCurrentBatch(
    sectionsWithHref,
    resumePosition?.sectionIndex ?? null,
  );

  const episodeTitle = episode.title || `Episode ${episode.episodeNum}`;
  const coverUrl = episode.coverUrl || video.coverUrl;

  const batchPreview = shellMovieLearningBatchPreview({
    title: episodeTitle,
    coverUrl,
    levels: video.levels,
    releaseAt: episode.releaseAt,
    durationMs: episode.durationMs,
    description: episode.description?.trim() || video.description,
    currentBatch,
    difficultyMix,
  });
  const sidebar = emptyMovieLearningSidebar({
    currentBatch,
    continueClipIndex: currentBatch ? continueStepForBatch(currentBatch) : 1,
  });

  return {
    ok: true,
    payload: JSON.parse(
      JSON.stringify({
        videoId: id,
        seasonId,
        episodeId,
        seasonNum: season.seasonNum,
        episodeNum: episode.episodeNum,
        seriesVideoId: video.id,
        sections: sectionsWithHref,
        totalParts,
        estimatedSectionCount,
        hasMoreSections,
        batchPreview,
        sidebar,
      }),
    ),
  };
}
