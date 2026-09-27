import {
  fetchMostRecentCompletedClip,
  type RecentCompletedClipRow,
} from "@/lib/db/queries/userPartProgress";
import { getStreakForUser } from "@/lib/db/learningStreak";
import { getTodayXp } from "@/lib/db/userXp";
import { clipXpAmount } from "@/lib/gamification/clipXp";
import { resolveLearnerVisiblePlacement } from "@/lib/learning/resolveLearnerVisiblePlacement";
import { visibleStepFromBookmarkOrder } from "@/lib/learning/sectionResume";
import { dashTime } from "@/lib/debug/dashboardTiming";
import type { UserId } from "@/types/schema";

export type RecentActivityItem = {
  id: string;
  occurredAt: string;
  xp: number;
  videoTitle?: string;
  section?: number;
  /** 1-based visible learning unit step within the section. */
  unit?: number;
  isSeries?: boolean;
  seasonNum?: number;
  episodeNum?: number;
};

export type RecentActivityFeed = {
  lastCompleted: RecentActivityItem | null;
  dailyXp: number;
  streakCurrent: number;
  streakUpdatedAt: string | null;
};

function dayKeyToIso(key: string): string {
  const [yy, mm, dd] = key.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 12, 0, 0).toISOString();
}

/** Display estimate for activity row (first-time clip completion). */
function estimateClipXpForActivity(score: number): number {
  if (score <= 0) return 0;
  return clipXpAmount(undefined, { score });
}

function sectionAndUnitFromOrder(order: number): { section: number; unit: number } {
  const { sectionIndex, visibleUnitStep } = visibleStepFromBookmarkOrder(order);
  return { section: sectionIndex, unit: visibleUnitStep };
}

/**
 * Prefer placement stored at completion. Legacy rows (null columns) keep the
 * old adaptive reconstruction path for backward compatibility only.
 */
async function sectionAndUnitForCompletedClip(
  userId: UserId,
  row: RecentCompletedClipRow,
): Promise<{ section: number; unit: number }> {
  if (row.sessionSectionIndex != null && row.visibleUnitStep != null) {
    return {
      section: row.sessionSectionIndex,
      unit: row.visibleUnitStep,
    };
  }

  if (!row.videoId) {
    return sectionAndUnitFromOrder(row.order);
  }

  const placement = await dashTime(
    "resolveLearnerVisiblePlacement(legacyRecentActivity)",
    () =>
      resolveLearnerVisiblePlacement({
        userId,
        rootVideoId: row.videoId!,
        rootVideoType: row.videoType,
        episodeId: row.episodeId,
        partId: row.partId,
        atomicOrder: row.order,
        preferBookmark: false,
      }),
  );

  return {
    section: placement.sectionIndex,
    unit: placement.visibleUnitStep,
  };
}

async function getLastCompletedClip(
  userId: UserId,
): Promise<RecentActivityItem | null> {
  const row = await dashTime("SQL fetchMostRecentCompletedClip", () =>
    fetchMostRecentCompletedClip(userId),
  );
  if (!row?.completedAt) return null;

  const videoName = row.directVideoName ?? row.seriesVideoName ?? undefined;
  const isSeries = row.videoType === "series";
  const { section, unit } = await sectionAndUnitForCompletedClip(userId, row);

  return {
    id: `completed-${row.progressId}`,
    occurredAt: row.completedAt.toISOString(),
    xp: estimateClipXpForActivity(row.lastScore),
    section,
    unit,
    videoTitle: videoName,
    isSeries,
    seasonNum: row.seasonNum ?? undefined,
    episodeNum: row.episodeNum ?? undefined,
  };
}

export async function getRecentActivityFeed(
  userId: UserId,
): Promise<RecentActivityFeed> {
  const [lastCompleted, dailyXp, streak] = await Promise.all([
    getLastCompletedClip(userId).catch((err) => {
      console.warn("[recentActivity] getLastCompletedClip:", err);
      return null;
    }),
    getTodayXp(userId).catch((err) => {
      console.warn("[recentActivity] getTodayXp:", err);
      return 0;
    }),
    getStreakForUser(userId),
  ]);

  return {
    lastCompleted,
    dailyXp,
    streakCurrent: streak.current,
    streakUpdatedAt: streak.lastDayKey ? dayKeyToIso(streak.lastDayKey) : null,
  };
}

export function hasRecentActivityContent(feed: RecentActivityFeed): boolean {
  return (
    feed.lastCompleted != null || feed.dailyXp > 0 || feed.streakCurrent > 0
  );
}

/** @deprecated Use getRecentActivityFeed */
export async function getUserRecentActivity(
  userId: UserId,
): Promise<RecentActivityItem | null> {
  const feed = await getRecentActivityFeed(userId);
  return feed.lastCompleted;
}
