/** Learner-facing steps per section — always 10 visible learning units. */
export const VISIBLE_UNITS_PER_SECTION = 10;

/**
 * Canonical atomic window size (legacy DB `part.order` section bounds).
 * Internal pipeline only — never shown in learner UI.
 */
export const PARTS_PER_SECTION = 10;

/** 0-based index window `[start, end)` into the global ordered curriculum array. */
export function globalSectionIndexWindow(
  sectionIndex: number,
  totalParts: number,
  pageSize: number = PARTS_PER_SECTION,
): { start: number; end: number } | null {
  if (sectionIndex < 1 || totalParts < 1) return null;
  const start = (sectionIndex - 1) * pageSize;
  if (start >= totalParts) return null;
  const end = Math.min(start + pageSize, totalParts);
  return { start, end };
}

/** How many parts appear in this section window (last section may be shorter). */
export function partsInSectionAtIndex(
  sectionIndex: number,
  totalParts: number,
  pageSize: number = PARTS_PER_SECTION,
): number {
  const window = globalSectionIndexWindow(sectionIndex, totalParts, pageSize);
  if (!window) return 0;
  return window.end - window.start;
}

export function sectionIndexFromOrder(order: number): number {
  return Math.floor((order - 1) / PARTS_PER_SECTION) + 1;
}

export function partInSectionFromOrder(order: number): number {
  return ((order - 1) % PARTS_PER_SECTION) + 1;
}

export function orderFromSectionPart(
  sectionIndex: number,
  partInSection: number,
): number {
  return (sectionIndex - 1) * PARTS_PER_SECTION + partInSection;
}

/** Canonical DB order bounds (progress, unlock, legacy URLs — not adaptive slicing). */
export function sectionOrderBounds(
  sectionIndex: number,
  totalParts: number,
): { start: number; end: number } | null {
  if (sectionIndex < 1 || totalParts < 1) return null;
  const start = (sectionIndex - 1) * PARTS_PER_SECTION + 1;
  if (start > totalParts) return null;
  const end = Math.min(sectionIndex * PARTS_PER_SECTION, totalParts);
  return { start, end };
}

export function totalSectionsForParts(totalParts: number): number {
  return Math.ceil(totalParts / PARTS_PER_SECTION);
}

/**
 * Pure index window into the globally sorted curriculum (no canonical `order` filter).
 * Section N = globalOrderedParts[(N-1)*pageSize : N*pageSize].
 */
export function sliceSectionFromGlobalOrder<T>(
  globallyOrderedParts: readonly T[],
  sectionIndex: number,
  pageSize: number = PARTS_PER_SECTION,
): T[] {
  if (sectionIndex < 1 || globallyOrderedParts.length < 1) return [];
  const start = (sectionIndex - 1) * pageSize;
  if (start >= globallyOrderedParts.length) return [];
  return globallyOrderedParts.slice(start, start + pageSize);
}
