import {
  getAvgResponseSec,
  getDueReviewRowsForUser,
  getHistoryContinueRows,
  getTodayLearningMinutes,
  getWeakSentenceCardsForUser,
} from "@/lib/db/progressOverview";
import {
  getDashboardProgressChartData,
  getSentenceInputStyleMix,
} from "@/lib/db/userDashboardStats";
import { getStreakForUser } from "@/lib/db/learningStreak";
import { avgAccuracyForUser } from "@/lib/db/queries/userPartProgress";
import type { UserId } from "@/types/schema";

export async function buildDashboardProgressPayload(
  userId: UserId,
  locale: string,
) {
  const [
    streak,
    chart,
    weakCards,
    dueReviews,
    history,
    todayMinutes,
    avgResponseSec,
    accAgg,
    styleMix,
  ] = await Promise.all([
    getStreakForUser(userId),
    getDashboardProgressChartData(userId, locale),
    getWeakSentenceCardsForUser(userId),
    getDueReviewRowsForUser(userId),
    getHistoryContinueRows(userId),
    getTodayLearningMinutes(userId),
    getAvgResponseSec(userId),
    avgAccuracyForUser(userId).then((a) => ({ _avg: { accuracy: a } })),
    getSentenceInputStyleMix(userId),
  ]);

  return JSON.parse(
    JSON.stringify({
      streakCurrent: streak.current,
      streakBest: streak.best,
      chartData: chart,
      weakCards,
      dueReviews,
      historyRows: history,
      todayMinutes,
      avgResponseSec,
      accuracyPercent: Math.round((accAgg._avg.accuracy ?? 0) * 100),
      sentenceInputStyle: styleMix,
      totalAttempts: chart?.insights.totalAttempts ?? 0,
      reviewsDueToday: chart?.insights.reviewsDueToday ?? 0,
    }),
  );
}
