import {
  acquireSkillBackfillLock,
  findUserOverallSkill,
  markSkillBackfillDone,
  releaseSkillBackfillLock,
} from "@/lib/db/queries/userAdaptiveSkill";
import { findUserEnglishLevelById } from "@/lib/db/queries/users";
import type { UserId } from "@/types/schema";
import { buildSkillResult } from "@/lib/skill/buildSkillResult";
import {
  clampSkill,
  priorFromEnglishLevel,
  SAFE_DEFAULT_SKILL,
} from "@/lib/skill/constants";
import {
  backfillSkillFromCompletedSections,
  userHasFullyCompletedSection,
} from "@/lib/skill/sectionSkill";
import type {
  BackfillState,
  LockState,
  SkillResult,
  SkillSource,
} from "@/lib/skill/skillTypes";

export type { SkillResult, SkillSource, BackfillState, LockState };
export { buildGuestSkillResult } from "@/lib/skill/buildSkillResult";

/**
 * Lightweight skill read for catalog / ordering paths.
 * Must NOT probe section completion — that would recurse into catalog builds.
 */
export async function resolveSkillForAdaptiveOrdering(
  userId: string,
): Promise<SkillResult> {
  const uid = userId as UserId;
  const stored = await findUserOverallSkill(uid);

  if (stored != null) {
    return buildSkillResult(uid, {
      skill: clampSkill(stored),
      source: "persisted",
      hasPersistedSkill: true,
      hasSections: false,
      backfillTriggered: false,
      skillNeedsBackfill: false,
      backfillState: "not_needed",
      lockState: "not_needed",
    });
  }

  const englishLevel = await findUserEnglishLevelById(uid);
  if (englishLevel != null) {
    return buildSkillResult(uid, {
      skill: clampSkill(priorFromEnglishLevel(englishLevel)),
      source: "cold_start",
      hasPersistedSkill: false,
      hasSections: false,
      backfillTriggered: false,
      skillNeedsBackfill: false,
      backfillState: "not_needed",
      lockState: "not_needed",
    });
  }

  return buildSkillResult(uid, {
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

/**
 * Resolves overall skill with an explicit, traceable source.
 * Triggers a one-time, DB-locked (60s TTL) EMA backfill when qualified sections exist but `overall_skill` is null.
 */
export async function resolveOverallSkill(userId: string): Promise<SkillResult> {
  const uid = userId as UserId;

  const stored = await findUserOverallSkill(uid);
  const hasPersistedSkill = stored != null;
  const hasSections = await userHasFullyCompletedSection(uid);

  if (hasPersistedSkill) {
    return buildSkillResult(uid, {
      skill: clampSkill(stored!),
      source: "persisted",
      hasPersistedSkill: true,
      hasSections,
      backfillTriggered: false,
      skillNeedsBackfill: false,
      backfillState: hasSections ? "done" : "not_needed",
      lockState: "already_complete",
    });
  }

  if (hasSections) {
    const { result: lock, lockState } = await acquireSkillBackfillLock(uid);

    if (lock === "already_complete") {
      const afterLock = await findUserOverallSkill(uid);
      if (afterLock != null) {
        return buildSkillResult(uid, {
          skill: clampSkill(afterLock),
          source: "persisted",
          hasPersistedSkill: true,
          hasSections: true,
          backfillTriggered: false,
          skillNeedsBackfill: false,
          backfillState: "done",
          lockState,
        });
      }
    }

    if (lock === "in_progress") {
      const concurrentSkill = await findUserOverallSkill(uid);
      if (concurrentSkill != null) {
        return buildSkillResult(uid, {
          skill: clampSkill(concurrentSkill),
          source: "persisted",
          hasPersistedSkill: true,
          hasSections: true,
          backfillTriggered: false,
          skillNeedsBackfill: false,
          backfillState: "done",
          lockState,
        });
      }

      const englishLevel = await findUserEnglishLevelById(uid);
      return buildSkillResult(uid, {
        skill: clampSkill(priorFromEnglishLevel(englishLevel)),
        source: "cold_start",
        hasPersistedSkill: false,
        hasSections: true,
        backfillTriggered: false,
        skillNeedsBackfill: true,
        backfillState: "in_progress",
        lockState,
      });
    }

    if (lock === "acquired") {
      let backfillTriggered = false;
      try {
        backfillTriggered = await backfillSkillFromCompletedSections(uid);
        await markSkillBackfillDone(uid);
      } catch (err) {
        await releaseSkillBackfillLock(uid);
        throw err;
      }

      const afterBackfill = await findUserOverallSkill(uid);
      if (afterBackfill != null) {
        return buildSkillResult(uid, {
          skill: clampSkill(afterBackfill),
          source: backfillTriggered ? "backfilled" : "persisted",
          hasPersistedSkill: true,
          hasSections: true,
          backfillTriggered,
          skillNeedsBackfill: false,
          backfillState: "done",
          lockState,
        });
      }

      console.error(
        "[adaptive-teacher] qualified sections exist but skill backfill did not persist overall_skill",
        { userId: uid, backfillTriggered, lockState },
      );

      const englishLevel = await findUserEnglishLevelById(uid);
      return buildSkillResult(uid, {
        skill: clampSkill(priorFromEnglishLevel(englishLevel)),
        source: "cold_start",
        hasPersistedSkill: false,
        hasSections: true,
        backfillTriggered,
        skillNeedsBackfill: true,
        backfillState: "done",
        lockState,
      });
    }

    console.error(
      "[adaptive-teacher] unexpected backfill lock state with no persisted skill",
      { userId: uid, lock, lockState },
    );
    const englishLevel = await findUserEnglishLevelById(uid);
    return buildSkillResult(uid, {
      skill: clampSkill(priorFromEnglishLevel(englishLevel)),
      source: "cold_start",
      hasPersistedSkill: false,
      hasSections: true,
      backfillTriggered: false,
      skillNeedsBackfill: true,
      backfillState: "none",
      lockState,
    });
  }

  const englishLevel = await findUserEnglishLevelById(uid);
  if (englishLevel != null) {
    return buildSkillResult(uid, {
      skill: clampSkill(priorFromEnglishLevel(englishLevel)),
      source: "cold_start",
      hasPersistedSkill: false,
      hasSections: false,
      backfillTriggered: false,
      skillNeedsBackfill: false,
      backfillState: "not_needed",
      lockState: "not_needed",
    });
  }

  return buildSkillResult(uid, {
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

/** @deprecated Prefer `resolveOverallSkill` for traceable `mode` and `stage`. */
export async function computeOverallSkill(userId: string): Promise<number> {
  const resolved = await resolveOverallSkill(userId);
  return resolved.skill;
}
