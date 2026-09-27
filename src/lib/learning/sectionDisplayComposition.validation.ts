/**
 *   npm run test:section-display-composition
 */
import assert from "node:assert/strict";
import {
  composeBatchDisplayItems,
  composeSectionDisplayItems,
  countBatchDisplayKinds,
  interleaveNewAndReview,
  SECTION_DISPLAY_CAPACITY,
} from "./sectionDisplayComposition";

function main() {
  const inter = interleaveNewAndReview(
    ["N1", "N2", "N3", "N4", "N5"],
    ["R1", "R2", "R3", "R4", "R5"],
  );
  const kinds = inter.map((s) => s.kind);
  assert.equal(kinds.length, 10);
  let maxRun = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of kinds) {
    if (k === prev) {
      run += 1;
    } else {
      run = 1;
      prev = k;
    }
    maxRun = Math.max(maxRun, run);
  }
  assert.ok(
    maxRun <= 3,
    `expected no long review block, max run=${maxRun} kinds=${kinds.join("")}`,
  );

  const sections = [
    {
      sectionIndex: 1,
      progressionUnits: Array.from({ length: 10 }, (_, i) => ({
        unitKey: `u${i + 1}`,
      })),
    },
    {
      sectionIndex: 2,
      progressionUnits: Array.from({ length: 10 }, (_, i) => ({
        unitKey: `u${i + 11}`,
      })),
    },
  ];

  const s1 = countBatchDisplayKinds(
    composeBatchDisplayItems({
      sections,
      targetSectionIndex: 1,
      isUnitComplete: () => false,
    }),
  );
  assert.equal(s1.total, SECTION_DISPLAY_CAPACITY);
  assert.equal(s1.review, 0);
  assert.equal(s1.new, 10);
  assert.equal(s1.completed, 0);

  const s2 = countBatchDisplayKinds(
    composeBatchDisplayItems({
      sections,
      targetSectionIndex: 2,
      isUnitComplete: () => false,
    }),
  );
  assert.equal(s2.total, SECTION_DISPLAY_CAPACITY);
  assert.equal(s2.review, 0);
  assert.equal(s2.new, 10);

  const completedFirst8 = (key: string) =>
    /^u[1-8]$/.test(key);
  const withProgress = countBatchDisplayKinds(
    composeBatchDisplayItems({
      sections: [
        {
          sectionIndex: 1,
          progressionUnits: Array.from({ length: 10 }, (_, i) => ({
            unitKey: `u${i + 1}`,
          })),
        },
      ],
      targetSectionIndex: 1,
      isUnitComplete: completedFirst8,
    }),
  );
  assert.deepEqual(withProgress, {
    completed: 8,
    review: 0,
    new: 2,
    total: 10,
  });

  const incompleteOnly = composeSectionDisplayItems({
    sections,
    targetSectionIndex: 1,
    isUnitComplete: () => false,
  });
  assert.equal(incompleteOnly.length, 10);
  assert.ok(incompleteOnly.every((i) => i.type === "new"));

  console.log("sectionDisplayComposition: ok");
}

main();
