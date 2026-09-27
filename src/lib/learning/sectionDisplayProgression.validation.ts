/**
 *   npm run test:section-display-progression
 */
import assert from "node:assert/strict";
import {
  composeBatchDisplayItems,
  countBatchDisplayKinds,
  SECTION_DISPLAY_CAPACITY,
} from "./sectionDisplayComposition";
import { resolveBatchIncompleteComposition } from "./sectionDisplayProgression";

function mkUnits(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ unitKey: `${prefix}${i + 1}` }));
}

function compose8Completed2New() {
  const completed = new Set(
    Array.from({ length: 8 }, (_, i) => `u${i + 1}`),
  );
  const sections = [
    {
      sectionIndex: 1,
      progressionUnits: mkUnits("u", 10),
    },
  ];
  return composeBatchDisplayItems({
    sections,
    targetSectionIndex: 1,
    isUnitComplete: (key) => completed.has(key),
  });
}

function main() {
  assert.deepEqual(
    resolveBatchIncompleteComposition({
      completedCount: 8,
      pendingReviewCount: 1,
    }),
    { incompleteSlots: 2, reviewsForBatch: 1, newForBatch: 1 },
  );

  const t1 = countBatchDisplayKinds(compose8Completed2New());
  assert.deepEqual(t1, { completed: 8, review: 0, new: 2, total: 10 });

  const sections12 = [
    { sectionIndex: 1, progressionUnits: mkUnits("u", 10) },
    { sectionIndex: 2, progressionUnits: mkUnits("v", 10) },
  ];
  const completedS1 = new Set(mkUnits("u", 8).map((u) => u.unitKey));
  const t5 = countBatchDisplayKinds(
    composeBatchDisplayItems({
      sections: sections12,
      targetSectionIndex: 2,
      isUnitComplete: (key, section) =>
        section === 1 ? completedS1.has(key) : false,
    }),
  );
  assert.deepEqual(t5, { completed: 0, review: 0, new: 10, total: 10 });

  const t8 = countBatchDisplayKinds(compose8Completed2New());
  assert.equal(t8.completed, 8);
  assert.equal(t8.total, SECTION_DISPLAY_CAPACITY);
  assert.equal(t8.review, 0);
  assert.equal(t8.new, 2);

  console.log("sectionDisplayProgression: ok");
}

main();
