import type { SectionDisplaySlot } from "@/lib/learning/buildSectionDisplaySession";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import type { PartProgress } from "@/lib/skill-engine/domain/types";

export type ComposedProgressRow = PartProgress & {
  lastScore?: number;
  sessionSectionIndex?: number | null;
  visibleUnitStep?: number | null;
};

/** 1-based step in the learn playlist (composition completed slots skipped). */
export function buildPlayableStepByPartId(
  displaySlots: readonly Pick<SectionDisplaySlot, "displayKind" | "unit">[],
): Map<string, number> {
  const map = new Map<string, number>();
  let step = 0;
  for (const slot of displaySlots) {
    if (slot.displayKind === "completed") continue;
    const id = slot.unit.parts[0]?.id;
    if (!id) continue;
    step += 1;
    map.set(id, step);
  }
  return map;
}

/** Review display occurrence complete (separate from historical unit completion). */
export function isComposedReviewDisplayComplete(params: {
  batchSectionIndex: number;
  partId: string;
  dueTodayPartIds: ReadonlySet<string>;
  progress: ComposedProgressRow | null | undefined;
  playableStepByPartId: ReadonlyMap<string, number>;
}): boolean {
  const row = params.progress;
  if (!row) return false;

  if (!params.dueTodayPartIds.has(params.partId)) {
    return isQualifiedComplete(row);
  }

  const expectedStep = params.playableStepByPartId.get(params.partId);
  if (expectedStep == null) return false;
  if (row.sessionSectionIndex !== params.batchSectionIndex) return false;
  if ((row.lastScore ?? 0) <= 0) return false;
  return row.visibleUnitStep === expectedStep;
}

export function isComposedBatchItemComplete(params: {
  inCompositionCompletedSet: boolean;
  displayKind: "new" | "review" | "completed" | undefined;
  partId: string;
  batchSectionIndex: number;
  dueTodayPartIds: ReadonlySet<string>;
  progress: ComposedProgressRow | null | undefined;
  playableStepByPartId: ReadonlyMap<string, number>;
}): boolean {
  if (
    params.inCompositionCompletedSet ||
    params.displayKind === "completed"
  ) {
    return true;
  }
  if (params.displayKind === "review") {
    return isComposedReviewDisplayComplete({
      batchSectionIndex: params.batchSectionIndex,
      partId: params.partId,
      dueTodayPartIds: params.dueTodayPartIds,
      progress: params.progress,
      playableStepByPartId: params.playableStepByPartId,
    });
  }
  return isQualifiedComplete(params.progress);
}
