import type { UserAchievementMetrics } from "@/lib/achievements/metrics";

/** Maps achievement `key` → live metric value. */
export function progressForAchievementKey(
  key: string,
  metrics: UserAchievementMetrics,
): number {
  switch (key) {
    case "clip-starter-i":
    case "clip-starter-ii":
    case "scene-master-i":
    case "fluent-journey":
      return metrics.completedClips;
    case "binge-learner":
      return metrics.completedEpisodes;
    case "series-explorer":
      return metrics.seriesWatched;
    case "movie-explorer":
      return metrics.moviesFinished;
    case "first-voice-line":
      return metrics.voiceExercises;
    case "smooth-speaker-i":
      return metrics.accuracy80Sessions;
    case "smooth-speaker-ii":
      return metrics.accuracy90Sessions;
    case "accent-hunter":
      return metrics.speakingDays;
    case "fast-mouth":
      return metrics.fastSpeakingRuns;
    case "word-collector-i":
    case "word-collector-ii":
      return metrics.wordsSaved;
    case "memory-builder":
      return metrics.vocabReviewDays;
    case "vocabulary-master":
      return metrics.wordsMastered;
    case "phrase-hunter":
      return metrics.phrasesSaved;
    case "day-one":
      return metrics.streakStarted;
    case "focused-mind":
    case "unbreakable":
      return metrics.currentStreak;
    case "night-learner":
      return metrics.nightLearningDays;
    case "early-bird":
      return metrics.morningLearningDays;
    case "quick-listener":
      return metrics.fastClips;
    case "lightning-brain":
      return metrics.timedClips;
    case "perfect-run":
      return metrics.flawlessClips;
    case "genre-hopper":
      return metrics.genresWatched;
    case "drama-expert":
      return metrics.dramaClips;
    case "comedy-addict":
      return metrics.comedyClips;
    case "lenra-veteran":
      return metrics.level;
    case "cinema-mind":
      return metrics.learningHours;
    default:
      return 0;
  }
}
