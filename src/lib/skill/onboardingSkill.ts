import { priorFromEnglishLevel } from "@/lib/skill/constants";
import type { EnglishLevel } from "@/types/schema";

export type OnboardingSkillLevel = "beginner" | "intermediate" | "advanced";

/** Low-confidence adaptive seed from onboarding self-assessment. */
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
 * Bootstrap skill for ordering before section EMA history exists.
 * Uses onboarding buckets where defined; finer levels use english_level priors.
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
