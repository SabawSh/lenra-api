import { EPISODE_SECTIONS_PAGE_BATCH } from "@/lib/learning/episodeSectionsBatch";
import {
  totalSectionsForParts,
  VISIBLE_UNITS_PER_SECTION,
} from "@/lib/learning/sections";

/** Fast UI estimate from atomic part count — no adaptive catalog walk. */
export function estimatedSectionCountFromParts(totalParts: number): number {
  if (totalParts < 1) return 0;
  return totalSectionsForParts(totalParts);
}

export function lastLoadedSectionIndex(
  sections: ReadonlyArray<{ sectionIndex: number }>,
): number {
  if (sections.length === 0) return 0;
  return sections[sections.length - 1]!.sectionIndex;
}

/** Next section index the map should fetch (1 when nothing is loaded yet). */
export function nextSectionsPageStartIndex(
  sections: ReadonlyArray<{ sectionIndex: number }>,
): number {
  const last = lastLoadedSectionIndex(sections);
  return last > 0 ? last + 1 : 1;
}

/**
 * Infinite scroll continues while the atomic estimate exceeds loaded rows,
 * even when the adaptive catalog walk reports no further merged sections.
 */
export function sectionsMapHasMorePages(params: {
  hasMoreFromCatalog: boolean;
  lastLoadedSectionIndex: number;
  estimatedSectionCount: number;
}): boolean {
  if (params.hasMoreFromCatalog) return true;
  if (params.estimatedSectionCount < 1) return false;
  return (
    params.lastLoadedSectionIndex > 0 &&
    params.lastLoadedSectionIndex < params.estimatedSectionCount
  );
}

export type SectionShellRow = {
  sectionIndex: number;
  clipCount: number;
  unlocked: boolean;
  playHref: string | null;
  startPart: number;
  firstClipUrl: string | null;
};

/** Locked placeholders derived from part totals (instant scroll batches).
 *  Named historically — rows are now content-accessible (progress is separate).
 */
export function buildLockedSectionShells(
  startSectionIndex: number,
  count: number,
): SectionShellRow[] {
  if (count < 1) return [];
  return Array.from({ length: count }, (_, i) => {
    const sectionIndex = startSectionIndex + i;
    return {
      sectionIndex,
      clipCount: VISIBLE_UNITS_PER_SECTION,
      unlocked: true,
      playHref: null,
      startPart: 1,
      firstClipUrl: null,
    };
  });
}

export function nextSectionBatchSize(
  startSectionIndex: number,
  estimatedSectionCount: number,
  batchSize: number = EPISODE_SECTIONS_PAGE_BATCH,
): number {
  if (startSectionIndex > estimatedSectionCount) return 0;
  return Math.min(batchSize, estimatedSectionCount - startSectionIndex + 1);
}

/**
 * Legacy skip: batches after the first locked card were painted locally
 * without hitting `/sections-state`. Do not use this to skip a fetch —
 * loaded rows lag `user_learning_resume.highest_unlocked_section`.
 */
export function batchIsLockedPlaceholderOnly(
  startSectionIndex: number,
  highestUnlockedSection: number,
): boolean {
  return startSectionIndex > highestUnlockedSection + 1;
}

/**
 * Load-more must always read unlock from the server. Loaded-row frontier
 * (SSR first page, or cards already on screen) is not a fetch-skip signal.
 */
export function shouldSkipSectionsStateFetch(_args?: {
  startSectionIndex: number;
  highestUnlockedFromLoadedRows: number;
}): false {
  return false;
}

export function highestUnlockedSectionIndex(
  sections: ReadonlyArray<{ sectionIndex: number; unlocked: boolean }>,
): number {
  let max = 1;
  for (const row of sections) {
    if (row.unlocked && row.sectionIndex > max) {
      max = row.sectionIndex;
    }
  }
  return max;
}

/** Server unlock rule used by the sections map: section N is playable iff N <= floor. */
export function sectionUnlockedByStoredFloor(
  sectionIndex: number,
  highestUnlockedSection: number,
): boolean {
  return sectionIndex <= 1 || sectionIndex <= highestUnlockedSection;
}
