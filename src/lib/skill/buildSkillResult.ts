import { SAFE_DEFAULT_SKILL } from "@/lib/skill/constants";
import {
  assertSkillResult,
  skillModeForSource,
  skillStageForSource,
  type BackfillState,
  type LockState,
  type SkillResult,
  type SkillSource,
} from "@/lib/skill/skillTypes";
import type { UserId } from "@/types/schema";

export type BuildSkillResultInput = {
  skill: number;
  source: SkillSource;
  hasPersistedSkill: boolean;
  hasSections: boolean;
  backfillTriggered: boolean;
  skillNeedsBackfill: boolean;
  backfillState: BackfillState;
  lockState: LockState;
};

/**
 * Single factory for all skill resolution outcomes (no silent numeric fallbacks).
 */
export function buildSkillResult(
  userId: UserId | null,
  input: BuildSkillResultInput,
): SkillResult {
  const result: SkillResult = {
    skill: input.skill,
    source: input.source,
    mode: skillModeForSource(input.source),
    stage: skillStageForSource(input.source),
    lockState: input.lockState,
    hasPersistedSkill: input.hasPersistedSkill,
    hasSections: input.hasSections,
    backfillTriggered: input.backfillTriggered,
    skillNeedsBackfill: input.skillNeedsBackfill,
    backfillState: input.backfillState,
  };

  assertSkillResult(result);
  return result;
}

/** Logged-out / guest sessions — canonical section order (no onboarding). */
export function buildGuestSkillResult(): SkillResult {
  return buildSkillResult(null, {
    skill: SAFE_DEFAULT_SKILL,
    source: "no_history",
    hasPersistedSkill: false,
    hasSections: false,
    backfillTriggered: false,
    skillNeedsBackfill: false,
    backfillState: "not_needed",
    lockState: "not_needed",
  });
}
