import { priorFromEnglishLevel } from "@/lib/skill/constants";
import type { EnglishLevel } from "@/types/schema";

export type OnboardingSkillLevel = "beginner" | "intermediate" | "advanced";

/**
 * Low-confidence Adaptive Teacher seed from onboarding self-assessment.
 * Used only to initialize `overall_skill` once — never as a runtime ability
 * source for chunking, hints, speaking tolerance, or challenge intensity.
 */
export function getOnboardingSkill(level: OnboardingSkillLevel): number {
  switch (level) {
    case "beginner":
      return 25;
    case "intermediate":
      return 50;
    case "advanced":
      return 75;
  }
}

/**
 * Map onboarding english_level → initial overall_skill seed value.
 * Persist via seedOverallSkillFromOnboardingIfAbsent; do not read at practice-time.
 */
export function getBootstrapSkillFromEnglishLevel(
  level: EnglishLevel | null | undefined,
): number {
  if (level == null) return getOnboardingSkill("intermediate");
  if (level === "beginner") return getOnboardingSkill("beginner");
  if (level === "intermediate") return getOnboardingSkill("intermediate");
  if (level === "advanced") return getOnboardingSkill("advanced");
  return priorFromEnglishLevel(level);
}
