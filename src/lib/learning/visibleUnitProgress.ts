import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import type { PartProgress } from "@/lib/skill-engine/domain/types";
import type { LearningUnit } from "@/lib/skill-engine/learning-units";
import type {
  AtomicPartInput,
  LearningUnitPartRef,
} from "@/lib/skill-engine/learning-units/types";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";

type PartWithProgress = LearningUnitPartRef & {
  progress?: PartProgress | null;
};

/** A visible learning unit is complete when every atomic clip inside it is qualified. */
export function isVisibleUnitComplete(
  unit: LearningUnit<PartWithProgress>,
): boolean {
  return unit.parts.every((part) => isQualifiedComplete(part.progress));
}

export function countCompletedVisibleUnits<T extends PartWithProgress>(
  units: readonly LearningUnit<T>[],
): number {
  return units.filter((unit) => isVisibleUnitComplete(unit)).length;
}

/** Section done when all 10 visible units are qualified-complete. */
export function isSectionVisuallyComplete<T extends PartWithProgress>(
  units: readonly LearningUnit<T>[],
): boolean {
  const visible = units.slice(0, VISIBLE_UNITS_PER_SECTION);
  if (visible.length < VISIBLE_UNITS_PER_SECTION) return false;
  return visible.every((unit) => isVisibleUnitComplete(unit));
}

/** Attach progress slices onto atomic part inputs for unit completion checks. */
export function attachProgressToAtomicParts<T extends AtomicPartInput>(
  parts: readonly T[],
  progressByPartId: ReadonlyMap<string, PartProgress | null>,
): Array<T & { progress: PartProgress | null }> {
  return parts.map((part) => ({
    ...part,
    progress: progressByPartId.get(part.id) ?? null,
  }));
}
