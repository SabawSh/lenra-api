import { EPISODE_SECTIONS_PAGE_BATCH } from "@/lib/learning/episodeSectionsBatch";
import {
  nextSectionBatchSize,
  sectionUnlockedByStoredFloor,
} from "@/lib/learning/episodeSectionsShell";

export type LoadMoreUnlockPlan =
  | { action: "stop" }
  | { action: "fetch-server-unlock"; startSectionIndex: number; batchSize: number };

/**
 * Decide how to fill the next sections-map page.
 * Never skip the unlock API because of cards already rendered.
 */
export function planLoadMoreUnlockFetch(params: {
  startSectionIndex: number;
  estimatedSectionCount: number;
  /** Ignored — loaded map rows are not the unlock source of truth. */
  highestUnlockedFromLoadedRows?: number;
  batchSize?: number;
}): LoadMoreUnlockPlan {
  const batchSize = nextSectionBatchSize(
    params.startSectionIndex,
    params.estimatedSectionCount,
    params.batchSize ?? EPISODE_SECTIONS_PAGE_BATCH,
  );
  if (batchSize < 1) return { action: "stop" };

  return {
    action: "fetch-server-unlock",
    startSectionIndex: params.startSectionIndex,
    batchSize,
  };
}

export type ServerUnlockRow = {
  sectionIndex: number;
  unlocked: boolean;
};

/** Rows the sections-state API would return for a stored unlock floor. */
export function serverUnlockRowsForFloor(params: {
  startSectionIndex: number;
  batchSize: number;
  highestUnlockedSection: number;
}): ServerUnlockRow[] {
  if (params.batchSize < 1) return [];
  return Array.from({ length: params.batchSize }, (_, i) => {
    const sectionIndex = params.startSectionIndex + i;
    return {
      sectionIndex,
      unlocked: sectionUnlockedByStoredFloor(
        sectionIndex,
        params.highestUnlockedSection,
      ),
    };
  });
}
