/**
 * Sections map load-more must not trust stale loaded unlock rows.
 *
 *   npx tsx lib/learning/episodeSectionsLoadMore.staleUnlock.validation.ts
 *
 * Repro: page opened at highest_unlocked_section = 19, then DB moved to 23.
 * Scrolling to sections 20–23 must fetch server state and show them unlocked.
 */
import {
  planLoadMoreUnlockFetch,
  serverUnlockRowsForFloor,
} from "./episodeSectionsLoadMore";
import {
  batchIsLockedPlaceholderOnly,
  highestUnlockedSectionIndex,
  shouldSkipSectionsStateFetch,
} from "./episodeSectionsShell";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SSR_BATCH = 9;

/** First page as rendered when the map opened at floor 19. */
const staleOpenedRows = Array.from({ length: SSR_BATCH }, (_, i) => ({
  sectionIndex: i + 1,
  unlocked: true,
}));

{
  const loadedFloor = highestUnlockedSectionIndex(staleOpenedRows);
  assert(loadedFloor === 9, `SSR first page max unlocked is 9, got ${loadedFloor}`);

  assert(
    batchIsLockedPlaceholderOnly(19, loadedFloor) === true,
    "legacy skip would paint 19+ as locked placeholders without a fetch",
  );
  assert(
    shouldSkipSectionsStateFetch({
      startSectionIndex: 19,
      highestUnlockedFromLoadedRows: loadedFloor,
    }) === false,
    "load-more must still fetch after DB unlock moved past loaded rows",
  );
}

{
  const plan = planLoadMoreUnlockFetch({
    startSectionIndex: 19,
    estimatedSectionCount: 40,
    highestUnlockedFromLoadedRows: highestUnlockedSectionIndex(staleOpenedRows),
  });
  assert(plan.action === "fetch-server-unlock", "stale floor 19 → 23 still fetches");
  if (plan.action !== "fetch-server-unlock") throw new Error("unreachable");
  assert(plan.startSectionIndex === 19, "next page starts at 19");
  assert(plan.batchSize === SSR_BATCH, `batch size ${plan.batchSize}`);

  const rows = serverUnlockRowsForFloor({
    startSectionIndex: plan.startSectionIndex,
    batchSize: plan.batchSize,
    highestUnlockedSection: 23,
  });

  const byIndex = new Map(rows.map((row) => [row.sectionIndex, row.unlocked]));
  assert(byIndex.get(19) === true, "section 19 unlocked at floor 23");
  assert(byIndex.get(20) === true, "section 20 unlocked at floor 23");
  assert(byIndex.get(21) === true, "section 21 unlocked at floor 23");
  assert(byIndex.get(22) === true, "section 22 unlocked at floor 23");
  assert(byIndex.get(23) === true, "section 23 unlocked at floor 23");
  assert(byIndex.get(24) === false, "section 24 still locked at floor 23");
  assert(byIndex.get(27) === false, "section 27 still locked at floor 23");
}

{
  const placeholdersWouldLock = serverUnlockRowsForFloor({
    startSectionIndex: 19,
    batchSize: 9,
    highestUnlockedSection: 0,
  });
  assert(
    placeholdersWouldLock.every((row) => row.unlocked === false),
    "locked placeholders would hide 20–23 even after the DB write",
  );
}

{
  const stop = planLoadMoreUnlockFetch({
    startSectionIndex: 41,
    estimatedSectionCount: 40,
    highestUnlockedFromLoadedRows: 9,
  });
  assert(stop.action === "stop", "pagination still stops past the catalog");
}

console.log("episodeSectionsLoadMore.staleUnlock: ok");
