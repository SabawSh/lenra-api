/** Max supported level for progression UI and validation. */
export const MAX_LEVEL = 200;

/** Coerce API/DB values; invalid input must not produce level 200 + NaN UI. */
export function normalizeTotalXp(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * XP needed to advance from `level` → `level + 1`.
 * Tuned for clip-only XP (drag +4, voice +6): early levels are quick,
 * later levels slow down; ~3k total XP ≈ level 12.
 */
export function xpRequiredForLevel(level: number): number {
  if (level < 1) return 0;
  return Math.floor(280 * Math.pow(1.12, level - 1));
}

/** @alias xpRequiredForLevel */
export const getXpForLevel = xpRequiredForLevel;

/** Total XP required to reach `level` (level 1 = 0 XP). */
export function cumulativeXpForLevel(level: number): number {
  if (level <= 1) return 0;
  let sum = 0;
  for (let l = 1; l < level; l++) {
    sum += xpRequiredForLevel(l);
  }
  return sum;
}

export function getLevelFromXp(totalXp: unknown): number {
  const xp = normalizeTotalXp(totalXp);
  let level = 1;
  while (level < MAX_LEVEL) {
    const threshold = cumulativeXpForLevel(level + 1);
    if (xp < threshold) break;
    level += 1;
  }
  return level;
}

export type LevelProgress = {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPercent: number;
};

export function getCurrentLevelProgress(totalXp: unknown): LevelProgress {
  const xp = normalizeTotalXp(totalXp);
  const level = getLevelFromXp(xp);

  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      xpIntoLevel: xp - cumulativeXpForLevel(MAX_LEVEL),
      xpForNextLevel: 0,
      progressPercent: 100,
    };
  }

  const floor = cumulativeXpForLevel(level);
  const xpIntoLevel = Math.max(0, xp - floor);
  const xpForNextLevel = xpRequiredForLevel(level);
  const progressPercent =
    xpForNextLevel > 0
      ? Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100))
      : 100;

  return { level, xpIntoLevel, xpForNextLevel, progressPercent };
}

/** @alias getCurrentLevelProgress */
export const getXpProgress = getCurrentLevelProgress;

export function getXpRemainingToNextLevel(totalXp: unknown): number {
  const { xpIntoLevel, xpForNextLevel, level } =
    getCurrentLevelProgress(totalXp);
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, xpForNextLevel - xpIntoLevel);
}
