/**
 * Learning Batch UI helpers — progress, continue, no per-card difficulty.
 *
 *   npm run test:learning-batch-ui
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import {
  assertNoCardDifficultyFields,
  batchCompletedCount,
  batchCompletedCountFromResume,
  batchIsComplete,
  buildBatchClipRows,
  displayBatchCompletedCount,
  pickCurrentBatch,
  resolveBatchCtaMode,
  resolveContinueClip,
  withBatchProgress,
  type LearningBatchMapItem,
} from "./learningBatchUi";
import { VISIBLE_UNITS_PER_SECTION } from "./sections";
import {
  partMatchesContentDifficultyFilter,
  videoMatchesContentDifficultyFilter,
} from "./videoDifficultyMix";
import {
  isSectionContentAccessible,
  SECTION_CONTENT_ACCESS_UNRESTRICTED,
} from "./sectionAccessPolicy";
import { pickFaOrFirstTranslation } from "./partTranslationDisplay";

assert.equal(VISIBLE_UNITS_PER_SECTION, 10, "batch size ≈ 10 clips");

// Resume proxy (legacy)
assert.equal(resolveContinueClip(1, 10), 1);
assert.equal(resolveContinueClip(4, 10), 4);
assert.equal(batchCompletedCountFromResume(4, 10), 3);
assert.equal(batchCompletedCountFromResume(1, 10), 0);
assert.equal(batchIsComplete(11, 10), true);

// Canonical completedCount wins over misleading startPart=1 on a finished batch
{
  const finished = withBatchProgress(
    {
      sectionIndex: 1,
      clipCount: 10,
      unlocked: true,
      playHref: "/x",
      startPart: 1, // resume reset — MUST NOT imply 0 completed
      firstClipUrl: null,
    },
    { completedCount: 10 },
  );
  assert.equal(displayBatchCompletedCount(finished), 10);
  assert.equal(batchCompletedCount(finished), 10);
  assert.equal(batchIsComplete(finished), true);
  assert.equal(resolveBatchCtaMode(finished), "review");
}

{
  const partial = withBatchProgress(
    {
      sectionIndex: 2,
      clipCount: 10,
      unlocked: true,
      playHref: "/x",
      startPart: 1,
      firstClipUrl: null,
    },
    { completedCount: 3 },
  );
  assert.equal(displayBatchCompletedCount(partial), 3);
  assert.equal(resolveBatchCtaMode(partial), "continue");
}

{
  const gapped = withBatchProgress(
    {
      sectionIndex: 3,
      clipCount: 7,
      unlocked: true,
      playHref: "/x",
      startPart: 6,
      firstClipUrl: null,
    },
    { completedCount: 4, startPart: 4 },
  );
  const rows = buildBatchClipRows(gapped);
  assert.equal(
    rows.find((r) => r.status === "current")?.clipIndex,
    4,
    "resume uses startPart not completedCount+1 when gaps exist",
  );
}

{
  const fresh = withBatchProgress(
    {
      sectionIndex: 3,
      clipCount: 10,
      unlocked: true,
      playHref: "/x",
      startPart: 1,
      firstClipUrl: null,
    },
    { completedCount: 0 },
  );
  assert.equal(resolveBatchCtaMode(fresh), "start");
}

{
  const rows = buildBatchClipRows(4, 10);
  assert.equal(rows.length, 10);
  assert.equal(rows[0]!.status, "completed");
  assert.equal(rows[3]!.status, "current");
}

{
  const rows = buildBatchClipRows(
    withBatchProgress(
      {
        sectionIndex: 1,
        clipCount: 10,
        unlocked: true,
        playHref: "/x",
        startPart: 1,
        firstClipUrl: null,
      },
      { completedCount: 10 },
    ),
  );
  assert.equal(rows.filter((r) => r.status === "completed").length, 10);
}

{
  const batches: LearningBatchMapItem[] = [
    withBatchProgress(
      {
        sectionIndex: 1,
        clipCount: 10,
        unlocked: true,
        playHref: "/learn/movie/v/section/1?step=1",
        startPart: 1,
        firstClipUrl: null,
      },
      { completedCount: 10 },
    ),
    withBatchProgress(
      {
        sectionIndex: 2,
        clipCount: 10,
        unlocked: true,
        playHref: "/learn/movie/v/section/2?step=4",
        startPart: 4,
        firstClipUrl: null,
      },
      { completedCount: 3 },
    ),
    withBatchProgress(
      {
        sectionIndex: 3,
        clipCount: 10,
        unlocked: true,
        playHref: "/learn/movie/v/section/3?step=1",
        startPart: 1,
        firstClipUrl: null,
      },
      { completedCount: 0 },
    ),
  ];

  // Next incomplete (with progress) — not completed batch 1
  const current = pickCurrentBatch(batches);
  assert.equal(current?.sectionIndex, 2);

  // Resume on completed batch 1 must NOT stay on 1 — advance to next incomplete
  const skippedCompletedResume = pickCurrentBatch(batches, 1);
  assert.equal(skippedCompletedResume?.sectionIndex, 2);

  // Resume on incomplete batch 2 is honored
  const resumed = pickCurrentBatch(batches, 2);
  assert.equal(resumed?.sectionIndex, 2);

  // Resume on empty batch 3
  const resumedFresh = pickCurrentBatch(batches, 3);
  assert.equal(resumedFresh?.sectionIndex, 3);
}

// Card models must not expose difficulty fields
assert.doesNotThrow(() =>
  assertNoCardDifficultyFields({
    clipIndex: 1,
    status: "completed",
    label: "Clip 1",
  }),
);
assert.throws(() =>
  assertNoCardDifficultyFields({
    clipIndex: 1,
    difficulty: "easy",
  }),
);

assert.equal(
  videoMatchesContentDifficultyFilter(
    { easy: 72, medium: 20, advanced: 8, total: 100 },
    "easy",
  ),
  true,
);
assert.equal(partMatchesContentDifficultyFilter("hard", "advanced"), true);

assert.equal(
  pickFaOrFirstTranslation([
    { language: "en", text: "Hello", translatedSentences: null },
    { language: "fa", text: "سلام", translatedSentences: null },
  ]),
  "سلام",
);

assert.equal(SECTION_CONTENT_ACCESS_UNRESTRICTED, true);
assert.equal(isSectionContentAccessible(7), true);

{
  const en = JSON.parse(
    readFileSync(join(process.cwd(), "messages/en.json"), "utf8"),
  ) as {
    episodeSectionsPage: Record<string, unknown>;
    sectionSummary: Record<string, string>;
  };
  const fa = JSON.parse(
    readFileSync(join(process.cwd(), "messages/fa.json"), "utf8"),
  ) as {
    episodeSectionsPage: Record<string, unknown>;
    sectionSummary: Record<string, string>;
  };
  assert.ok(String(en.episodeSectionsPage.currentBatchTitle).includes("10"));
  assert.ok(!String(en.episodeSectionsPage.sectionTitle).includes("{num}"));
  assert.equal(en.sectionSummary.title, "Batch complete");
  assert.ok(String(fa.episodeSectionsPage.currentBatchTitle).length > 0);
  assert.ok(String(fa.sectionSummary.ctaNextSection).length > 0);
  assert.ok(!("clipDifficulty" in en.episodeSectionsPage));
  assert.ok(!("clipDifficulty" in fa.episodeSectionsPage));
  assert.equal(en.episodeSectionsPage.stateNew, "New");
  assert.equal(fa.episodeSectionsPage.stateNew, "جدید");
  assert.equal(en.episodeSectionsPage.ctaContinueLearning, "Continue learning");
  assert.equal(fa.episodeSectionsPage.ctaContinueLearning, "ادامه یادگیری");
  assert.equal(en.episodeSectionsPage.ctaReviewBatch, "Review");
  assert.equal(fa.episodeSectionsPage.ctaReviewBatch, "مرور");
  assert.equal(en.episodeSectionsPage.batchPackTitle, "Pack {num}");
  assert.equal(fa.episodeSectionsPage.batchPackTitle, "بسته {num}");
  assert.ok(en.episodeSectionsPage.sidebar);
  assert.ok(fa.episodeSectionsPage.sidebar);
}

// Legacy number overload still works
assert.equal(batchCompletedCount(4, 10), 3);
assert.equal(batchCompletedCount(1, 10), 0);

console.log("learningBatchUi.validation: ok");
