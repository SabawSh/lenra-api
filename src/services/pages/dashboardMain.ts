import { getContinueLearningCards } from "@/lib/db/continueLearning";
import { getStreakForUser } from "@/lib/db/learningStreak";
import { getTodayLearningMinutes } from "@/lib/db/progressOverview";
import {
  getRecentActivityFeed,
  hasRecentActivityContent,
} from "@/lib/db/recentActivity";
import { getUserXpSummary } from "@/lib/db/userXp";
import { getVideoLibrary } from "@/lib/db/videoLibrary";
import { attachVideoLibraryProgress } from "@/lib/db/videoLibraryProgress";
import type { UserId } from "@/types/schema";

const DASHBOARD_VIDEO_PREVIEW = 4;

export async function buildDashboardMainPayload(userId: UserId) {
  const [
    streak,
    xp,
    continueCards,
    recentActivity,
    libraryVideos,
    minutesToday,
  ] = await Promise.all([
    getStreakForUser(userId).catch(() => ({
      current: 0,
      best: 0,
      lastDayKey: null,
    })),
    getUserXpSummary(userId).catch(() => ({
      dailyXp: 0,
      totalXp: 0,
      level: 1,
      progressPercent: 0,
      xpIntoLevel: 0,
      xpForNextLevel: 100,
      xpRemainingToNextLevel: 100,
    })),
    getContinueLearningCards(userId).catch(() => []),
    getRecentActivityFeed(userId).catch(() => ({
      lastCompleted: null,
      dailyXp: 0,
      streakCurrent: 0,
      streakUpdatedAt: null,
    })),
    getVideoLibrary().catch(() => []),
    getTodayLearningMinutes(userId).catch(() => 0),
  ]);

  const previewVideos = libraryVideos.slice(0, DASHBOARD_VIDEO_PREVIEW);
  const videos = await attachVideoLibraryProgress(userId, previewVideos).catch(
    () => previewVideos,
  );

  return {
    streak,
    xp,
    continueCards,
    recentActivity,
    videos,
    minutesToday,
    showContinueLearning: continueCards.length > 0,
    showRecentActivity: hasRecentActivityContent(recentActivity),
  };
}
