import {
  getEpisodeSummaryFields,
} from "@/lib/database";
import {
  getSectionProgressRowsForPartIds,
  type SectionPartProgressRow,
} from "@/lib/db/sectionProgress";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import { estimatedSectionCountFromParts } from "@/lib/learning/episodeSectionsShell";
import {
  countVisibleSections,
  evaluateSectionVisibleCompletion,
  getOrMaterializeProgressionSection,
  isSectionSessionFinished,
  loadCurriculumGlobalOrder,
  loadVisibleSectionCatalogPage,
  type SectionCurriculumScope,
} from "@/lib/learning/sectionCurriculum";
import { buildSectionSummaryStats } from "@/lib/learning/sectionSummaryStats";
import type { SectionSummaryStats } from "@/lib/learning/sectionSummaryStats";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { getUserById } from "@/lib/db/queries/users";
import type { UserId } from "@/types/schema";

async function resolveAdaptiveOrderUser(
  userId: UserId | null,
): Promise<AdaptiveOrderUser | null> {
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  return { id: userId, englishLevel: user.englishLevel };
}

export type SectionSummaryPageData = {
  stats: SectionSummaryStats;
  progressRows: SectionPartProgressRow[];
  totalSections: number;
  sectionComplete: boolean;
  nextSectionUnlocked: boolean;
  isLastSection: boolean;
  found: boolean;
};

/**
 * Single-pass loader for `?summary=1` — avoids rebuilding adaptive catalog 3–4×.
 */
export async function loadSectionSummaryPageData({
  scope,
  sectionIndex,
  userId,
  totalParts,
  episodeId,
  videoId,
}: {
  scope: SectionCurriculumScope;
  sectionIndex: number;
  userId: UserId | null;
  totalParts: number;
  episodeId?: string;
  videoId?: string;
}): Promise<SectionSummaryPageData> {
  const adaptiveUser = await resolveAdaptiveOrderUser(userId);

  const progressionScope = {
    scope,
    videoId: videoId ?? ("videoId" in scope ? scope.videoId : ""),
    episodeId: episodeId ?? ("episodeId" in scope ? scope.episodeId : null),
  };
  const currentEntry = await getOrMaterializeProgressionSection({
    progressionScope,
    sectionIndex,
    user: adaptiveUser,
    totalParts,
    mode: "read-only",
  });
  const globalOrder = await loadCurriculumGlobalOrder(scope, adaptiveUser, totalParts);
  const catalogPage = await loadVisibleSectionCatalogPage(globalOrder, adaptiveUser);
  if (!currentEntry || currentEntry.learningUnits.length === 0) {
    return {
      stats: buildSectionSummaryStats([]),
      progressRows: [],
      totalSections: Math.max(
        1,
        estimatedSectionCountFromParts(totalParts),
        catalogPage.entries.length,
      ),
      sectionComplete: false,
      nextSectionUnlocked: false,
      isLastSection: true,
      found: false,
    };
  }

  const progressRows = await getSectionProgressRowsForPartIds(
    userId,
    currentEntry.atomicParts,
  );

  const adaptiveSectionCount = await countVisibleSections(
    globalOrder,
    adaptiveUser,
  );
  const estimatedSectionCount = estimatedSectionCountFromParts(totalParts);
  const totalSections = Math.max(
    1,
    adaptiveSectionCount,
    estimatedSectionCount,
    catalogPage.entries.length,
  );
  const isLastSection = sectionIndex >= totalSections;

  const visibleCompletion = await evaluateSectionVisibleCompletion(
    currentEntry.learningUnits,
    userId,
    { progressionUnits: currentEntry.progressionUnits },
  );

  const progressionUnits =
    currentEntry.progressionUnits ?? currentEntry.learningUnits;
  const linesTarget = Math.min(
    VISIBLE_UNITS_PER_SECTION,
    progressionUnits.length,
  );
  const sessionFinished =
    userId != null &&
    (await isSectionSessionFinished(currentEntry, userId));
  const allLinesScored =
    visibleCompletion.completedUnitCount >= linesTarget;

  const sectionComplete =
    !userId || sessionFinished || allLinesScored || visibleCompletion.isComplete;

  // Next-section CTA: content access is unrestricted — offer N+1 whenever it exists.
  const nextSectionUnlocked = !isLastSection;

  const stats = buildSectionSummaryStats(progressRows, {
    progressionUnits,
  });

  return {
    stats,
    progressRows,
    totalSections,
    sectionComplete,
    nextSectionUnlocked,
    isLastSection,
    found: true,
  };
}

export async function loadSeriesSummaryTitle(
  episodeId: string,
  fallback: string,
): Promise<string> {
  const episodeFields = await getEpisodeSummaryFields(episodeId);
  return episodeFields?.title || fallback;
}
