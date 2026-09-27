import { getLevelFromXp, normalizeTotalXp } from "@/lib/gamification/levels";

/**
 * One-time divisor applied to pre–clip-economy lifetime XP (inflated awards).
 * 39,175 → 3,917 at divisor 10.
 */
export const LEGACY_XP_SCALE_DIVISOR = 10;

/** If the top user's XP is below this, the DB may already be migrated. */
export const LIKELY_MIGRATED_MAX_XP = 8_000;

export type RescaledXp = {
  legacyXp: number;
  totalXp: number;
  level: number;
};

export function rescaleLegacyXp(
  legacyXp: unknown,
  divisor: number = LEGACY_XP_SCALE_DIVISOR,
): number {
  const xp = normalizeTotalXp(legacyXp);
  if (xp <= 0) return 0;
  const d = Math.max(1, Math.floor(divisor));
  return Math.floor(xp / d);
}

export function rescaledXpAndLevel(
  legacyXp: unknown,
  divisor: number = LEGACY_XP_SCALE_DIVISOR,
): RescaledXp {
  const legacy = normalizeTotalXp(legacyXp);
  const totalXp = rescaleLegacyXp(legacy, divisor);
  return {
    legacyXp: legacy,
    totalXp,
    level: getLevelFromXp(totalXp),
  };
}

/** True when lifetime XP already looks like post-migration scale. */
export function databaseLooksXpMigrated(maxUserXp: number): boolean {
  return maxUserXp > 0 && maxUserXp <= LIKELY_MIGRATED_MAX_XP;
}
