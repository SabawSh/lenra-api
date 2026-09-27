import type { AchievementRarity } from "@/lib/dashboard/tokens";
import type { AchievementCategory } from "@/types/schema";

export type { AchievementCategory };

export type AchievementFilterCategory = AchievementCategory | "all";

export type AchievementStatus = "completed" | "in_progress" | "locked";

export type AchievementIconId =
  | "play"
  | "film"
  | "tv"
  | "clapperboard"
  | "mic"
  | "volume2"
  | "timer"
  | "bookOpen"
  | "bookMarked"
  | "crown"
  | "flame"
  | "moon"
  | "sun"
  | "zap"
  | "target"
  | "sparkles"
  | "theater"
  | "laugh"
  | "clock";

/** Serializable achievement row for client UI (from database). */
export type UserAchievementView = {
  /** Achievement definition key — used for i18n lookups. */
  id: string;
  iconId: AchievementIconId;
  category: AchievementCategory;
  rarity: AchievementRarity;
  xpReward: number;
  target: number;
  progress: number;
  status: AchievementStatus;
  unlockedAt?: string;
  nextTierKey?: string | null;
  relatedStatKey?: string | null;
};
