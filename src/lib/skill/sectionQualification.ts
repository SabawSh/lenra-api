/**
 * Atomic-part qualification helpers (persistence / per-clip checks only).
 * Section progression, unlock, and replay merge use visible learning units —
 * see `isSectionVisuallyComplete` in `visibleUnitProgress.ts`.
 */
export type SectionPartProgress = {
  completedAt: Date | null;
  bestScore: number;
};

export function isPartProgressQualified(
  part: SectionPartProgress,
): boolean {
  return part.completedAt != null && part.bestScore > 0;
}

export function isSectionFullyQualified(
  sectionParts: SectionPartProgress[],
): boolean {
  if (sectionParts.length === 0) return false;
  return sectionParts.every(isPartProgressQualified);
}
