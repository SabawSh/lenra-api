/**
 * Future unlock hooks (cosmetics, premium perks, league gates).
 * XP engine stays the source of truth; rewards plug in here later.
 */

export type LevelRewardKind =
  | "cosmetic"
  | "feature"
  | "badge"
  | "premium_trial";

export type LevelReward = {
  level: number;
  kind: LevelRewardKind;
  key: string;
};

/** Placeholder milestones — extend when achievement / cosmetics ship. */
export const LEVEL_REWARD_MILESTONES: LevelReward[] = [
  { level: 5, kind: "badge", key: "milestone_5" },
  { level: 10, kind: "badge", key: "milestone_10" },
  { level: 25, kind: "cosmetic", key: "ring_emerald" },
];

export function rewardsUnlockedAtLevel(level: number): LevelReward[] {
  return LEVEL_REWARD_MILESTONES.filter((r) => r.level <= level);
}

export function rewardsNewlyUnlocked(
  previousLevel: number,
  newLevel: number,
): LevelReward[] {
  return LEVEL_REWARD_MILESTONES.filter(
    (r) => r.level > previousLevel && r.level <= newLevel,
  );
}
