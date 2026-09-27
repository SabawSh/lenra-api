import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import type { LearningUnit } from "@/lib/skill-engine/learning-units/types";

/** Fixed batch size — normal learning progression only (no review slots). */
export const SECTION_DISPLAY_CAPACITY = VISIBLE_UNITS_PER_SECTION;

export type SectionDisplayReviewRef = {
  partId: string;
  reminderId: number;
};

export type SectionDisplayItem =
  | {
      type: "new";
      unitKey: string;
    }
  | {
      type: "review";
      partId: string;
      reminderId: number;
    };

export type BatchDisplayItem =
  | { type: "completed"; unitKey: string }
  | SectionDisplayItem;

export type ProgressionUnitRef = { unitKey: string };

export function interleaveNewAndReview<TNew, TReview>(
  newItems: readonly TNew[],
  reviewItems: readonly TReview[],
): Array<
  { kind: "new"; item: TNew } | { kind: "review"; item: TReview }
> {
  const n = newItems.length;
  const r = reviewItems.length;
  if (r === 0) {
    return newItems.map((item) => ({ kind: "new" as const, item }));
  }
  if (n === 0) {
    return reviewItems.map((item) => ({ kind: "review" as const, item }));
  }

  const total = n + r;
  const out: Array<
    { kind: "new"; item: TNew } | { kind: "review"; item: TReview }
  > = [];
  let ni = 0;
  let ri = 0;
  let placedReviews = 0;

  for (let pos = 0; pos < total; pos++) {
    const targetReviews = Math.round(((pos + 1) * r) / total);
    while (placedReviews < targetReviews && ri < r) {
      out.push({ kind: "review", item: reviewItems[ri]! });
      ri += 1;
      placedReviews += 1;
    }
    if (ni < n) {
      out.push({ kind: "new", item: newItems[ni]! });
      ni += 1;
    }
  }
  while (ri < r) {
    out.push({ kind: "review", item: reviewItems[ri]! });
    ri += 1;
  }
  while (ni < n) {
    out.push({ kind: "new", item: newItems[ni]! });
    ni += 1;
  }
  return out;
}

function unitKeyFromParts(parts: readonly { id: string }[]): string {
  return parts[0]?.id ?? "";
}

export function progressionUnitsToRefs(
  units: ReadonlyArray<LearningUnit<{ id: string }>>,
): ProgressionUnitRef[] {
  return units
    .map((unit) => ({ unitKey: unitKeyFromParts(unit.parts) }))
    .filter((u) => u.unitKey.length > 0);
}

export type SectionProgressionSlice = {
  sectionIndex: number;
  progressionUnits: ProgressionUnitRef[];
};

/** New units carried from prior batches after filling each batch to capacity. */
function carryOverNewBeforeSection(params: {
  sections: readonly SectionProgressionSlice[];
  beforeSectionIndex: number;
  capacity?: number;
}): ProgressionUnitRef[] {
  const cap = params.capacity ?? SECTION_DISPLAY_CAPACITY;
  const before = Math.max(0, params.beforeSectionIndex);
  const sortedSections = [...params.sections].sort(
    (a, b) => a.sectionIndex - b.sectionIndex,
  );

  let carryOverNew: ProgressionUnitRef[] = [];
  for (const section of sortedSections) {
    if (section.sectionIndex >= before) break;
    const pool = [...carryOverNew, ...section.progressionUnits];
    carryOverNew = pool.slice(cap);
  }
  return carryOverNew;
}

/**
 * Compose one batch (≤10 items): completed + new units in progression order only.
 * Due reviews are handled separately in Review Time — never mixed into batches.
 */
export function composeBatchDisplayItems(params: {
  sections: readonly SectionProgressionSlice[];
  targetSectionIndex: number;
  capacity?: number;
  isUnitComplete?: (unitKey: string, sectionIndex: number) => boolean;
}): BatchDisplayItem[] {
  const target = Math.max(1, params.targetSectionIndex);
  const isComplete = params.isUnitComplete ?? (() => false);
  const cap = params.capacity ?? SECTION_DISPLAY_CAPACITY;
  const sortedSections = [...params.sections].sort(
    (a, b) => a.sectionIndex - b.sectionIndex,
  );
  const targetSection = sortedSections.find((s) => s.sectionIndex === target);
  if (!targetSection) return [];

  const carryOverNew = carryOverNewBeforeSection({
    sections: params.sections,
    beforeSectionIndex: target,
    capacity: cap,
  });

  const pool = [...carryOverNew, ...targetSection.progressionUnits];
  const batchUnits = pool.slice(0, cap);

  return batchUnits.map((unit) =>
    isComplete(unit.unitKey, target)
      ? { type: "completed" as const, unitKey: unit.unitKey }
      : { type: "new" as const, unitKey: unit.unitKey },
  );
}

/** @deprecated Use composeBatchDisplayItems — returns session-only slice. */
export function composeSectionDisplayItems(params: {
  sections: readonly SectionProgressionSlice[];
  targetSectionIndex: number;
  dueReviews?: readonly SectionDisplayReviewRef[];
  capacity?: number;
  dueReviewAllocation?: string;
  isUnitComplete?: (unitKey: string, sectionIndex: number) => boolean;
}): SectionDisplayItem[] {
  return composeBatchDisplayItems(params).filter(
    (i): i is SectionDisplayItem => i.type !== "completed",
  );
}

export function completedProgressionUnitKeys(params: {
  progressionUnits: readonly ProgressionUnitRef[];
  sectionIndex: number;
  isUnitComplete: (unitKey: string, sectionIndex: number) => boolean;
}): string[] {
  return params.progressionUnits
    .filter((u) => params.isUnitComplete(u.unitKey, params.sectionIndex))
    .map((u) => u.unitKey);
}

export function countBatchDisplayKinds(items: readonly BatchDisplayItem[]): {
  completed: number;
  review: number;
  new: number;
  total: number;
} {
  let completed = 0;
  let review = 0;
  let newCount = 0;
  for (const item of items) {
    if (item.type === "completed") completed += 1;
    else if (item.type === "review") review += 1;
    else newCount += 1;
  }
  return { completed, review, new: newCount, total: items.length };
}
