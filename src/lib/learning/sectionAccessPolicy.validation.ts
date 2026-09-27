/**
 * Section content-access policy — sequential unlock is not an access gate.
 *
 *   npm run test:section-access-policy
 */
import assert from "node:assert/strict";
import {
  isSectionContentAccessible,
  SECTION_CONTENT_ACCESS_UNRESTRICTED,
} from "./sectionAccessPolicy";
import {
  buildMovieSectionPlayHref,
  buildSectionPlayHref,
} from "./sectionResume";
import { CONTENT_DIFFICULTY_FILTERS } from "./videoDifficultyMix";
import { sectionUnlockedByStoredFloor } from "./episodeSectionsShell";

assert.equal(SECTION_CONTENT_ACCESS_UNRESTRICTED, true);

// Access: any valid section index is open
assert.equal(isSectionContentAccessible(1), true);
assert.equal(isSectionContentAccessible(2), true);
assert.equal(isSectionContentAccessible(7), true);
assert.equal(isSectionContentAccessible(99), true);

// Invalid indices still rejected by access helper
assert.equal(isSectionContentAccessible(0), false);
assert.equal(isSectionContentAccessible(-1), false);
assert.equal(isSectionContentAccessible(Number.NaN), false);

// Locked batches omit play hrefs (sequential unlock on sections page).
{
  assert.equal(
    buildMovieSectionPlayHref(false, "movie", "vid-1", 7, 1),
    null,
  );
  assert.equal(
    buildSectionPlayHref(false, "vid-1", "s1", "e1", 7, 1),
    null,
  );
  const movieHref = buildMovieSectionPlayHref(true, "movie", "vid-1", 7, 1);
  assert.ok(movieHref);
  assert.match(movieHref!, /\/section\/7\?/);
}

// Progress floor metadata still exists for Continue Learning — but is NOT access
{
  assert.equal(sectionUnlockedByStoredFloor(1, 1), true);
  assert.equal(sectionUnlockedByStoredFloor(2, 1), false);
  assert.equal(sectionUnlockedByStoredFloor(7, 1), false);
  // Access policy ignores that floor:
  assert.equal(isSectionContentAccessible(7), true);
}

// Completing section 7 does not imply 1–6 complete (progress independence)
{
  const completed = new Set([7]);
  assert.equal(completed.has(1), false);
  assert.equal(completed.has(6), false);
  assert.equal(completed.has(7), true);
  assert.equal(isSectionContentAccessible(1), true);
  assert.equal(isSectionContentAccessible(7), true);
}

// Difficulty filter options unchanged
assert.deepEqual([...CONTENT_DIFFICULTY_FILTERS], [
  "All",
  "easy",
  "medium",
  "advanced",
]);

// UI: accessible sections get playable hrefs (no false lock via null href)
{
  const sections = [1, 2, 3, 7].map((sectionIndex) => ({
    sectionIndex,
    playHref: buildMovieSectionPlayHref(true, "movie", "v", sectionIndex, 1),
  }));
  assert.ok(sections.every((s) => s.playHref != null));
}

console.log("sectionAccessPolicy.validation: ok");
