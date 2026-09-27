import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { userCanAccessLearning } from "@/lib/payments/access";
import { getLearningResumePosition } from "@/lib/db/learningResume";
import * as videoQueries from "@/lib/db/queries/videos";
import {
  countPartsForVideo,
  getVideoSectionUnlockRows,
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
  buildMovieSectionPlayHref,
  resolveSectionStartStep,
} from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { emptyDifficultyMix } from "@/lib/learning/videoDifficultyMix";

export type MovieSectionsPageResult =
  | { ok: false; reason: "not_found" | "learning_blocked" }
  | { ok: true; payload: Record<string, unknown> };

export async function buildMovieSectionsPage(
  id: string,
): Promise<MovieSectionsPageResult> {
  const user = await getCurrentUser().catch(() => null);
  if (user && !(await userCanAccessLearning(user))) {
    return { ok: false, reason: "learning_blocked" };
  }

  const [movie, totalParts, difficultyMixMap] = await Promise.all([
    videoQueries.fetchVideoScalarsById(id),
    countPartsForVideo(id),
    videoQueries.countPartDifficultyForVideoIds([id]),
  ]);

  if (
    !movie ||
    (movie.type !== "movie" && movie.type !== "documentary") ||
    totalParts < 1
  ) {
    return { ok: false, reason: "not_found" };
  }

  const difficultyMix = difficultyMixMap.get(id) ?? emptyDifficultyMix();
  const learnType = movie.type === "documentary" ? "documentary" : "movie";

  const [resumePosition, unlockPage] = await Promise.all([
    user != null
      ? getLearningResumePosition({ userId: user.id, videoId: id })
      : null,
    getVideoSectionUnlockRows({
      userId: user?.id ?? null,
      videoId: id,
      totalParts,
      startSectionIndex: 1,
      sectionLimit: EPISODE_SECTIONS_PAGE_BATCH,
    }),
  ]);

  const estimatedSectionCount = estimatedSectionCountFromParts(totalParts);
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
      playHref: buildMovieSectionPlayHref(
        row.unlocked,
        learnType,
        id,
        row.sectionIndex,
        startPart,
      ),
      firstClipUrl: null as null,
    };
  });

  const initialSections = await enrichBatchesWithPartProgress({
    userId: user?.id ?? null,
    videoId: id,
    totalParts,
    adaptiveUser,
    batches: shellSections,
  });

  const sectionsWithHref = await finalizeLearningBatchPage({
    enriched: initialSections,
    userId: user?.id ?? null,
    videoId: id,
    totalParts,
    adaptiveUser,
    buildPlayHref: (row, step) =>
      buildMovieSectionPlayHref(true, learnType, id, row.sectionIndex, step),
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

  const batchPreview = shellMovieLearningBatchPreview({
    title: movie.name,
    coverUrl: movie.coverUrl,
    levels: movie.levels,
    releaseAt: movie.releaseAt,
    durationMs: movie.durationMs,
    description: movie.description,
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
        movieName: movie.name,
        movieType: movie.type,
        learnType,
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
