import {
  findLatestLearningResume,
  type UserLearningResumeRecord,
} from "@/lib/db/queries/userLearningResume";
import { computeScopeProgress } from "@/lib/db/scopeProgress";
import {
  fetchEpisodeById,
  fetchSeasonById,
  fetchVideoScalarsById,
} from "@/lib/db/queries/videos";
import { bookmarkOrderForVisibleStep } from "@/lib/learning/sectionResume";
import { logStoredUnlockState } from "@/lib/learning/resolveUnlockFrontier";
import { dashTime } from "@/lib/debug/dashboardTiming";
import type { UserId } from "@/types/schema";

export type ContinueLearningCard = {
  id: string;
  videoId: string;
  title: string;
  section: number;
  part: number;
  progressPct: number;
  minutesLeft: number | null;
  href: string;
  coverUrl: string | null;
  isSeries: boolean;
  seasonNum: number | null;
  episodeNum: number | null;
  seriesTitle: string | null;
};

async function cardFromLearningResume(
  userId: UserId,
  resume: UserLearningResumeRecord,
): Promise<ContinueLearningCard | null> {
  const video = await dashTime("fetchVideoScalarsById(continue)", () =>
    fetchVideoScalarsById(resume.videoId),
  );
  if (!video) return null;

  const isSeries = video.type === "series";
  const section = resume.resumeSection;
  const part = resume.resumePart;
  const bookmarkOrder = bookmarkOrderForVisibleStep(section, part);

  let href: string | null = null;
  let scope: { videoId: string } | { episodeId: string } | null = null;
  let seasonNum: number | null = null;
  let episodeNum: number | null = null;

  if (isSeries) {
    const seasonId = resume.seasonId;
    const episodeId = resume.episodeId;
    if (!seasonId || !episodeId) return null;

    href = `/learn/series/${resume.videoId}/${seasonId}/${episodeId}/section/${section}?step=${part}`;
    scope = { episodeId };

    const [episode, season] = await Promise.all([
      fetchEpisodeById(episodeId),
      fetchSeasonById(seasonId),
    ]);
    episodeNum = episode?.episodeNum ?? null;
    seasonNum = season?.seasonNum ?? null;
  } else {
    href = `/learn/${video.type}/${resume.videoId}/section/${section}?step=${part}`;
    scope = { videoId: resume.videoId };
  }

  if (!href || !scope) return null;

  if (process.env.DEBUG_SECTION_UNLOCK === "1") {
    logStoredUnlockState("getContinueLearningCards", {
      resumeSection: resume.resumeSection,
      resumePart: resume.resumePart,
      highestUnlockedSection: resume.highestUnlockedSection,
      continueHrefSection: section,
    });
  }

  const { progressPct, minutesLeft } = await dashTime(
    "computeScopeProgress",
    () => computeScopeProgress(userId, scope, bookmarkOrder),
  );

  return {
    id: `vid:${resume.videoId}`,
    videoId: resume.videoId,
    title: video.name,
    section,
    part,
    progressPct,
    minutesLeft,
    href,
    coverUrl: video.coverUrl ?? null,
    isSeries,
    seasonNum,
    episodeNum,
    seriesTitle: isSeries ? video.name : null,
  };
}

/**
 * Continue Learning card from the persisted journey pointer only.
 * Does not rebuild adaptive curriculum / visible section catalog.
 */
export async function getContinueLearningCards(
  userId: UserId,
): Promise<ContinueLearningCard[]> {
  const resume = await dashTime("SQL findLatestLearningResume", () =>
    findLatestLearningResume(userId),
  );

  if (!resume) return [];

  const card = await dashTime("cardFromLearningResume", () =>
    cardFromLearningResume(userId, resume),
  );

  return card ? [card] : [];
}
