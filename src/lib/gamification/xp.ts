import {
  getCurrentLevelProgress,
  MAX_LEVEL,
  normalizeTotalXp,
} from "@/lib/gamification/levels";
import type { UserId } from "@/types/schema";

/** XP is only awarded for completing a clip (see `learningXp`). */
export type XpReason = "complete_clip";

export const XP_REASONS = ["complete_clip"] as const satisfies XpReason[];

export function isXpReason(value: string): value is XpReason {
  return XP_REASONS.includes(value as XpReason);
}

export type AwardXpParams = {
  userId: UserId;
  amount: number;
  reason?: XpReason;
};

export type AwardXpResult = {
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  totalXp: number;
  xpGained: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  reason: XpReason;
};

export type GamificationProgress = {
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpRemainingToNextLevel: number;
  progressPercent: number;
};

export function getGamificationProgress(totalXp: unknown): GamificationProgress {
  const xp = normalizeTotalXp(totalXp);
  const { level, xpIntoLevel, xpForNextLevel, progressPercent } =
    getCurrentLevelProgress(xp);
  return {
    level,
    totalXp: xp,
    xpIntoLevel,
    xpForNextLevel,
    xpRemainingToNextLevel:
      level >= MAX_LEVEL ? 0 : Math.max(0, xpForNextLevel - xpIntoLevel),
    progressPercent,
  };
}

export type ClipXpAwardResult = AwardXpResult & {
  awards: AwardXpResult[];
  totalXpGained: number;
  reasons: XpReason[];
};

/** UI / toast payload after a clip completion award. */
export function toClipXpAwardResult(award: AwardXpResult): ClipXpAwardResult {
  return {
    ...award,
    awards: [award],
    totalXpGained: award.xpGained,
    reasons: [award.reason],
  };
}
