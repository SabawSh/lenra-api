/**
 *   npx tsx lib/learning/sequentialBatchUnlock.validation.ts
 */
import assert from "node:assert/strict";
import { batchIsComplete } from "./learningBatchUi";
import { applySequentialBatchUnlock } from "./sequentialBatchUnlock";
import { buildMovieSectionPlayHref } from "./sectionResume";

function batch(sectionIndex: number, completed: number) {
  return {
    sectionIndex,
    clipCount: 10,
    unlocked: true,
    playHref: "/x",
    firstClipUrl: null,
    completedCount: completed,
  };
}

const rows = applySequentialBatchUnlock(
  [batch(1, 10), batch(2, 0), batch(3, 0)],
  { priorBatchComplete: true },
);
assert.equal(rows[0]!.unlocked, true);
assert.equal(rows[1]!.unlocked, true);
assert.equal(rows[2]!.unlocked, false);

const page2 = applySequentialBatchUnlock([batch(11, 0)], {
  priorBatchComplete: false,
});
assert.equal(page2[0]!.unlocked, false);

assert.equal(
  buildMovieSectionPlayHref(false, "movie", "v1", 2, 1),
  null,
);

console.log("sequentialBatchUnlock.validation: ok");
