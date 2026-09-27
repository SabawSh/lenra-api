export { ACHIEVEMENT_DEFINITION_SEEDS } from "@/lib/achievements/definitions";
export { ensureAchievementDefinitions } from "@/lib/achievements/ensureDefinitions";
export {
  getUserAchievementsWithDefinitions,
  resolveAchievementStatus,
  syncUserAchievements,
  type SyncUserAchievementsResult,
  type UnlockedAchievementPayload,
} from "@/lib/achievements/engine";
export { findAchievementByKey } from "@/lib/achievements/findAchievementByKey";
export {
  getAchievementsPageData,
  type AchievementsPageData,
} from "@/lib/achievements/getPageData";
export { computeUserAchievementMetrics } from "@/lib/achievements/metrics";
export type {
  AchievementCategory,
  AchievementFilterCategory,
  AchievementIconId,
  AchievementStatus,
  UserAchievementView,
} from "@/lib/achievements/types";
