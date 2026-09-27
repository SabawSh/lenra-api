/**
 *   npm run test:review-learning-isolation
 */
import assert from "node:assert/strict";
import {
  composeBatchDisplayItems,
  countBatchDisplayKinds,
  SECTION_DISPLAY_CAPACITY,
} from "./sectionDisplayComposition";

function mkDueReviews(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    partId: `review-part-${i}`,
    reminderId: i + 1,
  }));
}

function main() {
  const sections = [
    {
      sectionIndex: 12,
      progressionUnits: Array.from({ length: 15 }, (_, i) => ({
        unitKey: `batch12-u${i + 1}`,
      })),
    },
  ];

  const withoutReviews = countBatchDisplayKinds(
    composeBatchDisplayItems({
      sections,
      targetSectionIndex: 12,
      isUnitComplete: () => false,
    }),
  );

  void mkDueReviews(5);

  const withFiveDueReviewsIgnored = countBatchDisplayKinds(
    composeBatchDisplayItems({
      sections,
      targetSectionIndex: 12,
      isUnitComplete: () => false,
    }),
  );

  assert.deepEqual(withFiveDueReviewsIgnored, withoutReviews);
  assert.equal(withFiveDueReviewsIgnored.total, SECTION_DISPLAY_CAPACITY);
  assert.equal(withFiveDueReviewsIgnored.review, 0);
  assert.equal(withFiveDueReviewsIgnored.new, SECTION_DISPLAY_CAPACITY);

  const completedBatch = countBatchDisplayKinds(
    composeBatchDisplayItems({
      sections: [
        {
          sectionIndex: 12,
          progressionUnits: Array.from({ length: 10 }, (_, i) => ({
            unitKey: `u${i + 1}`,
          })),
        },
      ],
      targetSectionIndex: 12,
      isUnitComplete: () => true,
    }),
  );
  assert.deepEqual(completedBatch, {
    completed: 10,
    review: 0,
    new: 0,
    total: 10,
  });

  console.log("reviewLearningIsolation: ok");
}

main();
