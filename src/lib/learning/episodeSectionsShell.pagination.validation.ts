/**
 * Sections map pagination must continue past the first adaptive catalog page.
 *
 *   npx tsx lib/learning/episodeSectionsShell.pagination.validation.ts
 */
import {
  lastLoadedSectionIndex,
  nextSectionsPageStartIndex,
  sectionsMapHasMorePages,
} from "./episodeSectionsShell";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const firstPage = Array.from({ length: 9 }, (_, i) => ({
    sectionIndex: i + 1,
  }));
  assert(lastLoadedSectionIndex(firstPage) === 9, "first page ends at 9");
  assert(nextSectionsPageStartIndex(firstPage) === 10, "next fetch starts at 10");

  const hasMore = sectionsMapHasMorePages({
    hasMoreFromCatalog: false,
    lastLoadedSectionIndex: 9,
    estimatedSectionCount: 81,
  });
  assert(hasMore === true, "catalog exhausted at 9 but estimate is 81 → keep scrolling");

  const done = sectionsMapHasMorePages({
    hasMoreFromCatalog: false,
    lastLoadedSectionIndex: 81,
    estimatedSectionCount: 81,
  });
  assert(done === false, "all estimated sections loaded → stop");
}

console.log("episodeSectionsShell.pagination: ok");
