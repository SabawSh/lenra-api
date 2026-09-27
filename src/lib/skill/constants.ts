import type { EnglishLevel } from "@/types/schema";

/**
 * EMA weight for section delta → skill update.
 * Gentle on purpose: a single strong section should nudge, not launch, skill.
 */
export const SKILL_SECTION_EMA_ALPHA = 0.18;

/**
 * Hard cap on how many skill points one section can move the estimate (either
 * direction). Prevents the "beginner aces a section → jumps to intermediate"
 * cliff even when the calibrated target is far from the current skill.
 */
export const SKILL_SECTION_MAX_DELTA = 5;

/**
 * Neutral skill value for `no_history` — only via `buildSkillResult()`.
 * Ordering uses canonical section order when onboarding is absent.
 */
export const SAFE_DEFAULT_SKILL = 50;

/** Cold-start priors for section EMA; onboarding buckets map to 25 / 50 / 75. */
export const ENGLISH_LEVEL_SKILL_PRIOR: Record<EnglishLevel, number> = {
  beginner: 25,
  elementary: 25,
  intermediate: 50,
  upperIntermediate: 50,
  advanced: 75,
};

export function clampSkill(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function priorFromEnglishLevel(level: EnglishLevel | null): number {
  if (level == null) return 50;
  return ENGLISH_LEVEL_SKILL_PRIOR[level] ?? 50;
}
