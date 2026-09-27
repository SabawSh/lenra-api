import type { UserId } from "@/types/schema";
import { getNumberLocale } from "@/helper/number";
import { localDateKey } from "@/lib/db/learningStreak";
import { countRemindersDueToday, countUserReminders } from "@/lib/db/reminders";
import { listUserDailyLearningTimeBetweenDayKeys } from "@/lib/db/queries/progress";
import {
  avgBestScoreForUser,
  countAllProgressRowsForUser,
  countCompletedRowsForUser,
  countInputModeDragForUser,
  countInputModeVoiceForUser,
  countStrongFinishRowsForUser,
  listBestScoresForUser,
  listLastAttemptAtInRange,
  listLastAttemptAtSince,
  sumAttemptsForUser,
} from "@/lib/db/queries/userPartProgress";

export type DashboardProgressInsights = {
  linesPracticed: number;
  linesCompleted: number;
  avgBestScore: number | null;
  strongFinishes: number;
  reviewsDueToday: number;
  activeDaysLast7: number;
  totalAttempts: number;
};

export async function getDashboardProgressInsights(
  userId: UserId,
): Promise<DashboardProgressInsights> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    practiced,
    completed,
    strongFinishes,
    avgBest,
    attemptsSum,
    recentAttemptAt,
    reviewsDueToday,
  ] = await Promise.all([
    countAllProgressRowsForUser(userId),
    countCompletedRowsForUser(userId),
    countStrongFinishRowsForUser(userId),
    avgBestScoreForUser(userId),
    sumAttemptsForUser(userId),
    listLastAttemptAtSince(userId, weekAgo),
    countRemindersDueToday(userId),
  ]);

  const activeDaysLast7 = new Set(
    recentAttemptAt.map((t) => {
      const d = new Date(t);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }),
  ).size;

  return {
    linesPracticed: practiced,
    linesCompleted: completed,
    avgBestScore:
      avgBest != null ? Math.round(avgBest) : null,
    strongFinishes,
    reviewsDueToday,
    activeDaysLast7,
    totalAttempts: attemptsSum,
  };
}

/** Share of sentence-builder completions logged as drag vs voice (one row per part with `lastSentenceInputMode` set). */
export async function getSentenceInputStyleMix(userId: UserId): Promise<{
  voice: number;
  drag: number;
}> {
  const [voiceN, dragN] = await Promise.all([
    countInputModeVoiceForUser(userId),
    countInputModeDragForUser(userId),
  ]);
  const tracked = voiceN + dragN;
  if (tracked === 0) {
    return { voice: 0, drag: 0 };
  }
  const voicePct = Math.round((voiceN / tracked) * 100);
  return { voice: voicePct, drag: 100 - voicePct };
}

function dayLabel(dateKey: string, locale: string): string {
  const [yy, mm, dd] = dateKey.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  return new Intl.DateTimeFormat(getNumberLocale(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string, locale: string): string {
  const [yy, mm] = month.split("-").map(Number);
  const d = new Date(yy, mm - 1, 1);
  return new Intl.DateTimeFormat(getNumberLocale(locale), {
    month: "short",
  }).format(d);
}

export type DashboardWeekDayRow = {
  /** Short label for axis (locale-aware). */
  label: string;
  /** `YYYY-MM-DD`, server-local calendar (matches streak / daily learning upsert). */
  dateKey: string;
  /** Lines with activity that day (from progress rows). */
  linesCount: number;
  learningMs: number;
  /** Pre-rounded minutes for chart scale (1 decimal). */
  minutes: number;
  isPeak: boolean;
};

export type DashboardMonthDayRow = DashboardWeekDayRow;

export type DashboardYearMonthRow = {
  /** Short month label for axis (locale-aware). */
  label: string;
  /** `YYYY-MM`, server-local calendar month key. */
  monthKey: string;
  /** Lines with activity in this month (from progress rows). */
  linesCount: number;
  learningMs: number;
  /** Pre-rounded minutes for chart scale (1 decimal). */
  minutes: number;
  isPeak: boolean;
};

export type DashboardProgressChartData = {
  insights: DashboardProgressInsights;
  cardsBar: {
    nameKey: "cardsTried" | "cardsCleared" | "cardsStrong";
    value: number;
  }[];
  scoreBuckets: {
    nameKey: "bucket0_59" | "bucket60_77" | "bucket78_87" | "bucket88";
    value: number;
  }[];
  /** Last seven calendar days, oldest → newest. */
  weekDays: DashboardWeekDayRow[];
  /** Last thirty calendar days, oldest → newest. */
  monthDays: DashboardMonthDayRow[];
  /** Last twelve calendar months, oldest → newest. */
  yearMonths: DashboardYearMonthRow[];
  remindersLater: number;
  totalReminders: number;
};

export async function getDashboardProgressChartData(
  userId: UserId,
  locale: string,
): Promise<DashboardProgressChartData> {
  const insights = await getDashboardProgressInsights(userId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekWindowStart = new Date(today);
  weekWindowStart.setDate(weekWindowStart.getDate() - 6);
  const monthWindowStart = new Date(today);
  monthWindowStart.setDate(monthWindowStart.getDate() - 29);
  const yearWindowStart = new Date(
    today.getFullYear(),
    today.getMonth() - 11,
    1,
  );
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + 1);

  const weekDayKeys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekWindowStart);
    d.setDate(weekWindowStart.getDate() + i);
    weekDayKeys.push(localDateKey(d));
  }

  const monthDayKeys: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(monthWindowStart);
    d.setDate(monthWindowStart.getDate() + i);
    monthDayKeys.push(localDateKey(d));
  }

  const yearMonthKeys: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(
      yearWindowStart.getFullYear(),
      yearWindowStart.getMonth() + i,
      1,
    );
    yearMonthKeys.push(monthKey(d));
  }
  const yearStartDayKey = localDateKey(yearWindowStart);
  const todayDayKey = localDateKey(today);

  const [windowRowsTimes, timeRows, bestScores, totalReminders] =
    await Promise.all([
      listLastAttemptAtInRange(userId, yearWindowStart, windowEnd),
      listUserDailyLearningTimeBetweenDayKeys(
        userId,
        yearStartDayKey,
        todayDayKey,
      ),
      listBestScoresForUser(userId),
      countUserReminders(userId),
    ]);

  const weekCounts = new Map<string, number>();
  for (const k of weekDayKeys) weekCounts.set(k, 0);
  const monthCounts = new Map<string, number>();
  for (const k of monthDayKeys) monthCounts.set(k, 0);
  const yearCounts = new Map<string, number>();
  for (const k of yearMonthKeys) yearCounts.set(k, 0);

  for (const t of windowRowsTimes) {
    const k = localDateKey(new Date(t));
    if (weekCounts.has(k)) weekCounts.set(k, (weekCounts.get(k) ?? 0) + 1);
    if (monthCounts.has(k)) monthCounts.set(k, (monthCounts.get(k) ?? 0) + 1);
    const mk = monthKey(new Date(t));
    if (yearCounts.has(mk)) yearCounts.set(mk, (yearCounts.get(mk) ?? 0) + 1);
  }

  const msByDay = new Map(
    timeRows.map((r) => [r.dayKey, r.learningTimeMs] as const),
  );

  const maxWeekLearningMs = Math.max(
    0,
    ...weekDayKeys.map((k) => msByDay.get(k) ?? 0),
  );
  const maxMonthLearningMs = Math.max(
    0,
    ...monthDayKeys.map((k) => msByDay.get(k) ?? 0),
  );

  const weekDays: DashboardWeekDayRow[] = weekDayKeys.map((k) => {
    const learningMs = msByDay.get(k) ?? 0;
    return {
      label: dayLabel(k, locale),
      dateKey: k,
      linesCount: weekCounts.get(k) ?? 0,
      learningMs,
      minutes: Math.round((learningMs / 60000) * 10) / 10,
      isPeak: maxWeekLearningMs > 0 && learningMs === maxWeekLearningMs,
    };
  });

  const monthDays: DashboardMonthDayRow[] = monthDayKeys.map((k) => {
    const learningMs = msByDay.get(k) ?? 0;
    return {
      label: dayLabel(k, locale),
      dateKey: k,
      linesCount: monthCounts.get(k) ?? 0,
      learningMs,
      minutes: Math.round((learningMs / 60000) * 10) / 10,
      isPeak: maxMonthLearningMs > 0 && learningMs === maxMonthLearningMs,
    };
  });

  const yearMsByMonth = new Map<string, number>();
  for (const k of yearMonthKeys) yearMsByMonth.set(k, 0);
  for (const [dayKey, learningMs] of msByDay.entries()) {
    const mk = dayKey.slice(0, 7);
    if (yearMsByMonth.has(mk)) {
      yearMsByMonth.set(mk, (yearMsByMonth.get(mk) ?? 0) + learningMs);
    }
  }
  const maxYearLearningMs = Math.max(
    0,
    ...yearMonthKeys.map((k) => yearMsByMonth.get(k) ?? 0),
  );
  const yearMonths: DashboardYearMonthRow[] = yearMonthKeys.map((k) => {
    const learningMs = yearMsByMonth.get(k) ?? 0;
    return {
      label: monthLabel(k, locale),
      monthKey: k,
      linesCount: yearCounts.get(k) ?? 0,
      learningMs,
      minutes: Math.round((learningMs / 60000) * 10) / 10,
      isPeak: maxYearLearningMs > 0 && learningMs === maxYearLearningMs,
    };
  });

  const b = [0, 0, 0, 0];
  for (const bestScore of bestScores) {
    if (bestScore < 60) b[0]++;
    else if (bestScore < 78) b[1]++;
    else if (bestScore < 88) b[2]++;
    else b[3]++;
  }

  const scoreBuckets: DashboardProgressChartData["scoreBuckets"] = [
    { nameKey: "bucket0_59", value: b[0] },
    { nameKey: "bucket60_77", value: b[1] },
    { nameKey: "bucket78_87", value: b[2] },
    { nameKey: "bucket88", value: b[3] },
  ];

  const cardsBar: DashboardProgressChartData["cardsBar"] = [
    { nameKey: "cardsTried", value: insights.linesPracticed },
    { nameKey: "cardsCleared", value: insights.linesCompleted },
    { nameKey: "cardsStrong", value: insights.strongFinishes },
  ];

  const remindersLater = Math.max(0, totalReminders - insights.reviewsDueToday);

  return {
    insights,
    cardsBar,
    scoreBuckets,
    weekDays,
    monthDays,
    yearMonths,
    remindersLater,
    totalReminders,
  };
}
