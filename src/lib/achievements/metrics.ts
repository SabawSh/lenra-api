import type { UserId } from "@/types/schema";
import {
  alignLearningStreakWithActivity,
  getStreakForUser,
  localDateKey,
} from "@/lib/db/learningStreak";
import { getLevelFromXp } from "@/lib/gamification/levels";
import { asStringArray } from "@/lib/db/jsonStringArray";
import { findUserTotalsForAchievementMetrics } from "@/lib/db/queries/users";
import {
  countAchievementMetric,
  countCompletedRowsForUser,
  listAchievementAttemptJoinedRows,
  listAchievementCompletedJoinedRows,
  listAllCompletedPartIdsForUser,
  type AchievementAttemptJoinedRow,
} from "@/lib/db/queries/userPartProgress";
import {
  countSavedVocabularyCardsForUser,
  countSavedVocabularySentenceWithSpaces,
  countSavedVocabularyWithReviewStrengthGte,
  listSavedVocabularyLastReviewedDates,
} from "@/lib/db/queries/savedVocabularyCards";
import {
  listAllEpisodePartIdGroups,
  listMoviesWithStandalonePartGroups,
} from "@/lib/db/queries/videos";

const MASTERED_REVIEW_STRENGTH = 5;
const NIGHT_HOUR = 21;
const MORNING_HOUR = 8;
const PHRASE_MIN_WORDS = 3;

export type UserAchievementMetrics = {
  completedClips: number;
  completedEpisodes: number;
  seriesWatched: number;
  moviesFinished: number;
  voiceExercises: number;
  accuracy80Sessions: number;
  accuracy90Sessions: number;
  speakingDays: number;
  fastSpeakingRuns: number;
  wordsSaved: number;
  wordsMastered: number;
  vocabReviewDays: number;
  phrasesSaved: number;
  currentStreak: number;
  streakStarted: number;
  nightLearningDays: number;
  morningLearningDays: number;
  fastClips: number;
  timedClips: number;
  flawlessClips: number;
  genresWatched: number;
  dramaClips: number;
  comedyClips: number;
  level: number;
  learningHours: number;
};

function countDistinctDayKeys(
  dates: Date[],
  predicate: (d: Date) => boolean,
): number {
  const days = new Set<string>();
  for (const date of dates) {
    const d = new Date(date);
    if (predicate(d)) days.add(localDateKey(d));
  }
  return days.size;
}

function hasGenre(genres: string[], target: string): boolean {
  const t = target.toLowerCase();
  return genres.some((g) => g.toLowerCase() === t);
}

function parseGenresRaw(raw: unknown): string[] {
  if (raw == null) return [];
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? asStringArray(v) : [];
}

function scopeVideoMetaFromJoined(
  row: AchievementAttemptJoinedRow,
): { id: string; type: string; genres: string[] } | null {
  if (!row.svId) return null;
  return {
    id: row.svId,
    type: row.svType ?? "",
    genres: parseGenresRaw(row.svGenresRaw),
  };
}

/** Aggregate live user stats used to drive achievement progress. */
export async function computeUserAchievementMetrics(
  userId: UserId,
): Promise<UserAchievementMetrics> {
  await alignLearningStreakWithActivity(userId);

  const [
    user,
    streak,
    completedClips,
    partAttempts,
    wordsSaved,
    wordsMastered,
    vocabReviewDates,
    phrasesSaved,
    voiceExercises,
    accuracy80Sessions,
    accuracy90Sessions,
    fastSpeakingRuns,
    fastClips,
    timedClips,
    flawlessClips,
    completedJoinedRows,
    completedPartIds,
  ] = await Promise.all([
    findUserTotalsForAchievementMetrics(userId),
    getStreakForUser(userId),
    countCompletedRowsForUser(userId),
    listAchievementAttemptJoinedRows(userId),
    countSavedVocabularyCardsForUser(userId),
    countSavedVocabularyWithReviewStrengthGte(
      userId,
      MASTERED_REVIEW_STRENGTH,
    ),
    listSavedVocabularyLastReviewedDates(userId),
    countSavedVocabularySentenceWithSpaces(userId),
    countAchievementMetric(userId, "completed_voice"),
    countAchievementMetric(userId, "completed_voice_acc80"),
    countAchievementMetric(userId, "completed_voice_acc90"),
    countAchievementMetric(userId, "completed_voice_fast"),
    countAchievementMetric(userId, "completed_acc80_fast"),
    countAchievementMetric(userId, "completed_fast_duration"),
    countAchievementMetric(userId, "completed_flawless_accuracy"),
    listAchievementCompletedJoinedRows(userId),
    listAllCompletedPartIdsForUser(userId),
  ]);

  const attemptDates = partAttempts.map((a) => a.lastAttemptAt);
  const nightLearningDays = countDistinctDayKeys(
    attemptDates,
    (d) => d.getHours() >= NIGHT_HOUR,
  );
  const morningLearningDays = countDistinctDayKeys(
    attemptDates,
    (d) => d.getHours() < MORNING_HOUR,
  );

  const voiceSpeakingDays = countDistinctDayKeys(
    partAttempts
      .filter((a) => a.lastSentenceInputMode === "voice")
      .map((a) => a.lastAttemptAt),
    () => true,
  );

  const vocabReviewDaySet = new Set<string>();
  for (const lastReviewedAt of vocabReviewDates) {
    vocabReviewDaySet.add(localDateKey(lastReviewedAt));
  }

  const genresSet = new Set<string>();
  let dramaClips = 0;
  let comedyClips = 0;

  for (const row of partAttempts) {
    if (!row.completedAt) continue;
    const video = scopeVideoMetaFromJoined(row);
    if (!video) continue;
    const genres = video.genres;
    for (const g of genres) {
      genresSet.add(g.toLowerCase());
    }
    if (hasGenre(genres, "drama")) dramaClips += 1;
    if (hasGenre(genres, "comedy")) comedyClips += 1;
  }

  const seriesVideoIds = new Set<string>();
  const movieVideoIds = new Set<string>();

  for (const row of completedJoinedRows) {
    if (!row.svId) continue;
    const video = { id: row.svId, type: row.svType ?? "" };
    if (video.type === "series") {
      seriesVideoIds.add(row.svId);
    }
    if (video.type === "movie" || video.type === "documentary") {
      movieVideoIds.add(row.svId);
    }
  }

  const completedEpisodes = await countFullyCompletedEpisodes(completedPartIds);
  const moviesFinished = await countFullyCompletedMovies(
    [...movieVideoIds],
    completedPartIds,
  );

  const level = getLevelFromXp(user?.xp ?? 0);
  const learningHours = Math.floor((user?.totalLearningTimeMs ?? 0) / 3_600_000);
  const streakStarted =
    streak.current > 0 || (user?.learningStreakBest ?? 0) > 0 ? 1 : 0;

  return {
    completedClips,
    completedEpisodes,
    seriesWatched: seriesVideoIds.size,
    moviesFinished,
    voiceExercises,
    accuracy80Sessions,
    accuracy90Sessions,
    speakingDays: voiceSpeakingDays,
    fastSpeakingRuns,
    wordsSaved,
    wordsMastered,
    vocabReviewDays: vocabReviewDaySet.size,
    phrasesSaved,
    currentStreak: streak.current,
    streakStarted,
    nightLearningDays,
    morningLearningDays,
    fastClips,
    timedClips,
    flawlessClips,
    genresWatched: genresSet.size,
    dramaClips,
    comedyClips,
    level,
    learningHours,
  };
}

async function countFullyCompletedEpisodes(
  completedPartIds: ReadonlySet<string>,
): Promise<number> {
  const episodes = await listAllEpisodePartIdGroups();
  if (episodes.length === 0) return 0;

  let count = 0;
  for (const ep of episodes) {
    if (ep.partIds.length === 0) continue;
    if (ep.partIds.every((pId) => completedPartIds.has(pId))) count += 1;
  }
  return count;
}

async function countFullyCompletedMovies(
  candidateVideoIds: string[],
  completedPartIds: ReadonlySet<string>,
): Promise<number> {
  if (candidateVideoIds.length === 0) return 0;

  const movies = await listMoviesWithStandalonePartGroups(
    candidateVideoIds,
  );

  let count = 0;
  for (const movie of movies) {
    if (movie.partIds.length === 0) continue;
    if (movie.partIds.every((pid) => completedPartIds.has(pid))) count += 1;
  }
  return count;
}
