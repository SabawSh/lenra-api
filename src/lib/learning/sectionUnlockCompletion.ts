import { resolveSpeechDurationMs } from "@/lib/learning/partTiming";
import type { SectionPartForLearningUnits } from "@/lib/learning/buildSectionLearningUnits";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import { isSectionVisuallyComplete } from "@/lib/learning/visibleUnitProgress";
import type { LearningUnit } from "@/lib/skill-engine/learning-units";

export type SectionUnlockProgressSlice = {
  bestScore: number;
  completedAt: Date | null;
  attempts: number;
  wrongMoves: number;
  sessionSectionIndex?: number | null;
};

export type SectionUnlockCatalogEntry = {
  sectionIndex: number;
  progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
};

function progressionUnitsForEntry(
  entry: Pick<
    SectionUnlockCatalogEntry,
    "progressionUnits" | "learningUnits"
  >,
): ReadonlyArray<LearningUnit<SectionPartForLearningUnits>> {
  return entry.progressionUnits ?? entry.learningUnits;
}

/**
 * Progress counts toward section N unlock only when earned in that visible section.
 *
 * Strict session match — legacy rows with `sessionSectionIndex = null` do NOT
 * qualify. Otherwise pre-placement / companion progress on atomic parts that
 * Adaptive Teacher later places in section N+1 falsely marks N+1 complete and
 * the unlock frontier jumps by two (complete N → unlock N+1 and N+2).
 */
export function isPartQualifiedForSectionUnlock(
  progress: SectionUnlockProgressSlice | null | undefined,
  sectionIndex: number,
): boolean {
  if (!isQualifiedComplete(progress)) return false;
  const sessionSection = progress?.sessionSectionIndex;
  if (sessionSection == null) return false;
  return sessionSection === sectionIndex;
}

export function isVisibleUnitUnlockComplete(
  unit: LearningUnit<
    SectionPartForLearningUnits & {
      progress?: SectionUnlockProgressSlice | null;
    }
  >,
  sectionIndex: number,
): boolean {
  return unit.parts.every((part) =>
    isPartQualifiedForSectionUnlock(part.progress, sectionIndex),
  );
}

/** Section unlock complete — all 10 progression steps qualified in this section session. */
export function isSectionUnlockComplete(
  units: readonly LearningUnit<
    SectionPartForLearningUnits & {
      progress?: SectionUnlockProgressSlice | null;
    }
  >[],
  sectionIndex: number,
): boolean {
  const visible = units.slice(0, VISIBLE_UNITS_PER_SECTION);
  if (visible.length < VISIBLE_UNITS_PER_SECTION) return false;
  return visible.every((unit) => isVisibleUnitUnlockComplete(unit, sectionIndex));
}

/**
 * Sync unlock check — learner-visible progression units only, session-scoped.
 * Merged steps count as one unit; replay-merged playback must not unlock early.
 */
export function isCatalogEntryUnlockCompleteSync(
  entry: SectionUnlockCatalogEntry,
  progressMap: ReadonlyMap<string, SectionUnlockProgressSlice | null>,
): boolean {
  if (progressMap.size === 0) return false;

  const unitsWithProgress = progressionUnitsForEntry(entry).map((unit) => ({
    ...unit,
    parts: unit.parts.map((part) => ({
      ...part,
      speechDurationMs: resolveSpeechDurationMs(part),
      progress: progressMap.get(part.id) ?? null,
    })),
  }));

  return isSectionUnlockComplete(unitsWithProgress, entry.sectionIndex);
}

/** First incomplete visible section (unlocked to play). All prior sections complete. */
export function computeUnlockFrontierSection(
  catalog: ReadonlyArray<Pick<SectionUnlockCatalogEntry, "sectionIndex">>,
  completions: readonly boolean[],
): number {
  for (let i = 0; i < completions.length; i++) {
    if (!completions[i]) {
      return catalog[i]!.sectionIndex;
    }
  }
  const last = catalog[catalog.length - 1];
  return last != null ? last.sectionIndex + 1 : 1;
}
