import type { SectionSummaryStats } from "@/lib/learning/sectionSummaryStats";
import { sectionVoiceShare, sectionXpProgress } from "@/lib/learning/sectionSummaryStats";

export type SectionCelebrationKey =
  | "voiceChampion"
  | "voiceStrong"
  | "voiceStarted"
  | "qualityStrong"
  | "effortSolid"
  | "default";

export type SectionRecommendationKey =
  | "moreVoice"
  | "voiceMistakesOk"
  | "keepVoice"
  | "retryQuality"
  | "finishSection"
  | "default";

export function pickSectionCelebrationKey(
  stats: SectionSummaryStats,
): SectionCelebrationKey {
  const voiceShare = sectionVoiceShare(stats);
  const xpProgress = sectionXpProgress(stats);

  if (stats.voiceCompletedCount >= 7) return "voiceChampion";
  if (voiceShare >= 50 && stats.voiceCompletedCount >= 3) return "voiceStrong";
  if (stats.voiceCompletedCount >= 1) return "voiceStarted";
  if (stats.avgBestScore >= 85 && xpProgress >= 60) return "qualityStrong";
  if (stats.sectionXp > 0) return "effortSolid";
  return "default";
}

export function pickSectionRecommendationKey(
  stats: SectionSummaryStats,
): SectionRecommendationKey {
  const voiceShare = sectionVoiceShare(stats);
  const completed =
    stats.voiceCompletedCount + stats.dragCompletedCount;

  if (completed < stats.totalInSection && stats.skippedCount > 0) {
    return "finishSection";
  }

  if (stats.avgBestScore >= 80 && voiceShare < 35 && completed >= 3) {
    return "moreVoice";
  }

  if (
    stats.voiceCompletedCount >= 3 &&
    stats.avgBestScore < 75 &&
    stats.totalWrongMoves >= 4
  ) {
    return "voiceMistakesOk";
  }

  if (voiceShare >= 50) return "keepVoice";

  if (stats.avgBestScore < 65 && stats.attemptedCount >= 3) {
    return "retryQuality";
  }

  if (stats.voiceCompletedCount === 0 && completed >= 2) return "moreVoice";

  return "default";
}

export type SectionXpTierKey = "legendary" | "strong" | "solid" | "building";

export function sectionXpTierKey(stats: SectionSummaryStats): SectionXpTierKey {
  const progress = sectionXpProgress(stats);
  if (progress >= 85) return "legendary";
  if (progress >= 65) return "strong";
  if (progress >= 40) return "solid";
  return "building";
}
