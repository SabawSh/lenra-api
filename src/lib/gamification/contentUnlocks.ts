import { normalizeTotalXp } from "@/lib/gamification/levels";

/**
 * Minimum lifetime XP for content tiers (post-migration scale).
 * Clip-only economy: drag +4, voice +6 on first completion.
 */
export const CONTENT_UNLOCK_MIN_XP = {
  /** Default catalog — no gate */
  open: 0,
  /** Early guided paths */
  beginner: 200,
  /** Mid library */
  intermediate: 500,
  /** Harder / longer series */
  advanced: 2_000,
  /** Premium / challenge catalog */
  master: 5_000,
} as const;

export type ContentUnlockTier = keyof typeof CONTENT_UNLOCK_MIN_XP;

export function xpRequiredForUnlockTier(tier: ContentUnlockTier): number {
  return CONTENT_UNLOCK_MIN_XP[tier];
}

export function isUnlockedForXp(
  totalXp: unknown,
  tier: ContentUnlockTier,
): boolean {
  return normalizeTotalXp(totalXp) >= CONTENT_UNLOCK_MIN_XP[tier];
}

export function isUnlockedForXpAmount(
  totalXp: unknown,
  requiredXp: number,
): boolean {
  return normalizeTotalXp(totalXp) >= Math.max(0, Math.floor(requiredXp));
}
