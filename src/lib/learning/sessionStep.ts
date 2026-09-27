import { partInSectionFromOrder } from "@/lib/learning/sections";
import type { LearningUnit } from "@/lib/skill-engine/learning-units";
import { sessionStepForStoryOrder } from "@/lib/skill-engine/learning-units";

/** Map canonical section slot (1..N) to 1-based adaptive session step. */
export function sessionStepForCanonicalPart(
  orderedParts: ReadonlyArray<{ order: number }>,
  canonicalPartInSection: number,
): number {
  const idx = orderedParts.findIndex(
    (p) => partInSectionFromOrder(p.order) === canonicalPartInSection,
  );
  return idx >= 0 ? idx + 1 : 1;
}

/** Map canonical section slot to 1-based step in a learning-unit playlist. */
export function sessionStepForCanonicalPartInUnits(
  units: ReadonlyArray<LearningUnit<{ id: string; order: number }>>,
  orderedParts: ReadonlyArray<{ order: number }>,
  canonicalPartInSection: number,
): number {
  const part = orderedParts.find(
    (p) => partInSectionFromOrder(p.order) === canonicalPartInSection,
  );
  if (!part) return 1;
  return sessionStepForStoryOrder(units, part.order);
}

/** Clamp session step to valid 1-based range for the playlist length. */
export function clampSessionStep(step: number, playlistLength: number): number {
  if (playlistLength < 1) return 1;
  if (!Number.isFinite(step) || step < 1) return 1;
  return Math.min(Math.floor(step), playlistLength);
}
