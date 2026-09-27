import {
  composeBatchDisplayItems,
  progressionUnitsToRefs,
  SECTION_DISPLAY_CAPACITY,
} from "@/lib/learning/sectionDisplayComposition";
import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import type { UserId } from "@/types/schema";
import type { VisibleSectionCatalogEntry } from "@/lib/learning/sectionCurriculum";
import { hydrateSectionPartsFromOrderMeta } from "@/lib/db/parts";
import type { LearningUnit } from "@/lib/skill-engine/learning-units/types";
import type { Part } from "@/types/video";

export type SectionSessionSlot = {
  displayKind: "new" | "review";
  unit: LearningUnit<Part>;
  reminderId?: number;
};

export type SectionCompletedSlot = {
  displayKind: "completed";
  unit: LearningUnit<Part>;
};

export type SectionDisplaySlot = SectionCompletedSlot | SectionSessionSlot;

export type SectionDisplayBuildResult = {
  /** Final composed batch in display order (length ≤ 10). */
  displaySlots: SectionDisplaySlot[];
  completedSlots: SectionCompletedSlot[];
  sessionSlots: SectionSessionSlot[];
};

function unitFromParts(parts: Part[]): LearningUnit<Part> | null {
  if (parts.length === 0) return null;
  const metrics = {
    difficulty: parts.reduce((s, p) => s + (p.difficultyScore ?? 0), 0),
    wordCount: parts.reduce((s, p) => s + (p.wordCount ?? 0), 0),
    speechDurationMs: parts.reduce(
      (s, p) => s + (p.speechDurationMs ?? p.playbackDurationMs ?? 0),
      0,
    ),
  };
  return {
    parts,
    metrics,
    targetZone: "near",
  };
}

/**
 * Build the composed display batch (≤10 slots): completed + new units in
 * progression order (no spaced-repetition review injection).
 */
export async function buildSectionDisplaySession(params: {
  catalogEntries: readonly VisibleSectionCatalogEntry[];
  targetSectionIndex: number;
  userId?: UserId | null;
  /** Hydrated progression units for the target section (materialized/adaptive). */
  targetProgressionUnits: ReadonlyArray<LearningUnit<Part>>;
}): Promise<SectionDisplayBuildResult> {
  const sections = params.catalogEntries.map((entry) => ({
    sectionIndex: entry.sectionIndex,
    progressionUnits:
      entry.sectionIndex === params.targetSectionIndex
        ? progressionUnitsToRefs(params.targetProgressionUnits)
        : progressionUnitsToRefs(entry.progressionUnits ?? entry.learningUnits),
  }));

  const partIdsForProgress = new Set<string>();
  for (const entry of params.catalogEntries) {
    if (entry.sectionIndex > params.targetSectionIndex) continue;
    const units =
      entry.sectionIndex === params.targetSectionIndex
        ? params.targetProgressionUnits
        : entry.progressionUnits.length > 0
          ? entry.progressionUnits
          : entry.learningUnits;
    for (const unit of units) {
      for (const p of unit.parts) partIdsForProgress.add(p.id);
    }
  }

  const progressSlices =
    params.userId && partIdsForProgress.size > 0
      ? await listProgressSliceForParts(params.userId, [...partIdsForProgress])
      : [];
  const progressByPartId = new Map(
    progressSlices.map((s) => [s.partId, s] as const),
  );
  const isUnitComplete = (unitKey: string, _sectionIndex: number) => {
    const row = progressByPartId.get(unitKey);
    return isQualifiedComplete(
      row
        ? {
            bestScore: row.bestScore,
            completedAt: row.completedAt,
            attempts: row.attempts,
            wrongMoves: row.wrongMoves,
          }
        : null,
    );
  };

  const batchItems = composeBatchDisplayItems({
    sections,
    targetSectionIndex: params.targetSectionIndex,
    isUnitComplete,
  });

  const unitByKey = await hydrateProgressionUnitMap({
    catalogEntries: params.catalogEntries,
    targetSectionIndex: params.targetSectionIndex,
    targetProgressionUnits: params.targetProgressionUnits,
  });

  const displaySlots: SectionDisplaySlot[] = [];
  for (const item of batchItems) {
    if (item.type === "completed") {
      const unit = unitByKey.get(item.unitKey);
      if (unit) displaySlots.push({ displayKind: "completed", unit });
      continue;
    }
    if (item.type === "new") {
      const unit = unitByKey.get(item.unitKey);
      if (!unit) continue;
      displaySlots.push({ displayKind: "new", unit });
    }
  }

  if (displaySlots.length === 0) {
    const fallback = params.targetProgressionUnits
      .slice(0, SECTION_DISPLAY_CAPACITY)
      .map((unit) => ({
        displayKind: "new" as const,
        unit,
      }));
    return {
      displaySlots: fallback,
      completedSlots: [],
      sessionSlots: fallback,
    };
  }

  const completedSlots = displaySlots.filter(
    (s): s is SectionCompletedSlot => s.displayKind === "completed",
  );
  const sessionSlots = displaySlots.filter(
    (s): s is SectionSessionSlot => s.displayKind !== "completed",
  );

  return { displaySlots, completedSlots, sessionSlots };
}

export function mergeSectionDisplayPartIds(
  build: SectionDisplayBuildResult,
): string[] {
  return build.displaySlots.flatMap((s) => s.unit.parts.map((p) => p.id));
}

/** Flatten session slots to part ids for logging. */
export function flattenSessionSlotPartIds(
  slots: readonly SectionSessionSlot[],
): string[] {
  return slots.flatMap((s) => s.unit.parts.map((p) => p.id));
}

/** @deprecated Prefer mergeSectionDisplayPartIds. */
export function flattenDisplayBuildPartIds(
  build: SectionDisplayBuildResult,
): string[] {
  return mergeSectionDisplayPartIds(build);
}

async function hydrateProgressionUnitMap(params: {
  catalogEntries: readonly VisibleSectionCatalogEntry[];
  targetSectionIndex: number;
  targetProgressionUnits: ReadonlyArray<LearningUnit<Part>>;
}): Promise<Map<string, LearningUnit<Part>>> {
  const map = new Map<string, LearningUnit<Part>>();
  for (const unit of params.targetProgressionUnits) {
    const key = unit.parts[0]?.id;
    if (key) map.set(key, unit);
  }

  const missingPartIds = new Set<string>();
  for (const entry of params.catalogEntries) {
    if (entry.sectionIndex > params.targetSectionIndex) continue;
    const units =
      entry.progressionUnits.length > 0
        ? entry.progressionUnits
        : entry.learningUnits;
    for (const unit of units) {
      const key = unit.parts[0]?.id;
      if (!key || map.has(key)) continue;
      for (const p of unit.parts) missingPartIds.add(p.id);
    }
  }

  if (missingPartIds.size > 0) {
    const hydrated = await hydrateSectionPartsFromOrderMeta(
      [...missingPartIds].map((id) => ({ id })),
    );
    const byId = new Map(hydrated.map((p) => [p.id, p] as const));
    for (const entry of params.catalogEntries) {
      if (entry.sectionIndex > params.targetSectionIndex) continue;
      const units =
        entry.progressionUnits.length > 0
          ? entry.progressionUnits
          : entry.learningUnits;
      for (const unit of units) {
        const key = unit.parts[0]?.id;
        if (!key || map.has(key)) continue;
        const parts = unit.parts
          .map((p) => byId.get(p.id))
          .filter((p): p is Part => p != null);
        const built = unitFromParts(parts);
        if (built) map.set(key, built);
      }
    }
  }

  return map;
}
