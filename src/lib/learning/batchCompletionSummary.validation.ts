/**
 * Batch completion summary — scoped metrics + null when incomplete.
 *
 *   npm run test:batch-completion-summary
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { buildBatchCompletionSummary, recentBatchFromCompletionSummary } from "./batchCompletionSummary";
import {
  pickNextIncompleteBatch,
  withBatchProgress,
  type LearningBatchMapItem,
} from "./learningBatchUi";

function clip(
  partId: string,
  opts: { completed?: boolean; saved?: boolean; state?: "new" | "review" | "completed" } = {},
) {
  return {
    partId,
    completed: opts.completed ?? false,
    saved: opts.saved ?? false,
    state: opts.state ?? (opts.completed ? "completed" : "new"),
  };
}

function slice(
  partId: string,
  opts: {
    bestScore?: number;
    completed?: boolean;
    wrongMoves?: number;
    mode?: "drag" | "voice";
  } = {},
) {
  return {
    partId,
    bestScore: opts.bestScore ?? 80,
    completedAt: opts.completed === false ? null : new Date(),
    attempts: 1,
    wrongMoves: opts.wrongMoves ?? 0,
    accuracy: 0.9,
    speed: 0.8,
    lastSentenceInputMode: opts.mode ?? ("drag" as const),
  };
}

// Incomplete → no summary
{
  const summary = buildBatchCompletionSummary({
    sectionIndex: 1,
    clips: [
      clip("a", { completed: true }),
      clip("b", { completed: false }),
    ],
    progressSlices: [slice("a"), slice("b", { completed: false })],
  });
  assert.equal(summary, null, "incomplete batch must not get a summary");
}

// Complete → real metrics
{
  const summary = buildBatchCompletionSummary({
    sectionIndex: 2,
    clips: [
      clip("a", { completed: true, saved: true }),
      clip("b", { completed: true, saved: false, state: "review" }),
      clip("c", { completed: true, saved: true }),
    ],
    progressSlices: [
      slice("a", { bestScore: 90 }),
      slice("b", { bestScore: 70 }),
      slice("c", { bestScore: 80 }),
    ],
  });
  assert.ok(summary, "fully completed batch gets a summary");
  assert.equal(summary!.sectionIndex, 2);
  assert.equal(summary!.completedCount, 3);
  assert.equal(summary!.totalCount, 3);
  assert.equal(summary!.avgBestScore, 80);
  assert.equal(summary!.savedVocabCount, 2);
  assert.equal(summary!.reviewDueCount, 1);
  assert.ok(summary!.sectionXp > 0, "XP derived from progress");
  assert.ok(summary!.maxSectionXp >= summary!.sectionXp);
}

// Sidebar mapper: incomplete → null, complete → scoped card
{
  assert.equal(recentBatchFromCompletionSummary(null), null);
  const mapped = recentBatchFromCompletionSummary({
    sectionIndex: 1,
    completedCount: 10,
    totalCount: 10,
    sectionXp: 42,
    maxSectionXp: 120,
    avgBestScore: 85,
    savedVocabCount: 4,
    reviewDueCount: 0,
  });
  assert.deepEqual(mapped, {
    sectionIndex: 1,
    completedCount: 10,
    totalCount: 10,
    sectionXp: 42,
    savedVocabCount: 4,
    avgBestScore: 85,
  });
}

// Next incomplete batch after a completed one
{
  const batches: LearningBatchMapItem[] = [
    withBatchProgress(
      { sectionIndex: 1, clipCount: 10, unlocked: true, playHref: "/a", startPart: 1 },
      { completedCount: 10, clipCount: 10 },
    ),
    withBatchProgress(
      { sectionIndex: 2, clipCount: 10, unlocked: true, playHref: "/b", startPart: 1 },
      { completedCount: 3, clipCount: 10 },
    ),
    withBatchProgress(
      { sectionIndex: 3, clipCount: 10, unlocked: true, playHref: "/c", startPart: 1 },
      { completedCount: 0, clipCount: 10 },
    ),
  ];
  const next = pickNextIncompleteBatch(batches, 1);
  assert.equal(next?.sectionIndex, 2, "Continue Learning → next incomplete");
  assert.equal(pickNextIncompleteBatch(batches, 2)?.sectionIndex, 3);
  assert.equal(
    pickNextIncompleteBatch(
      [
        withBatchProgress(
          { sectionIndex: 1, clipCount: 10, unlocked: true, playHref: "/a", startPart: 1 },
          { completedCount: 10, clipCount: 10 },
        ),
      ],
      1,
    ),
    null,
    "no incomplete left → null",
  );
}

// Batch-switch ownership: summary for A must not apply to incomplete B
{
  const summaryA = buildBatchCompletionSummary({
    sectionIndex: 1,
    clips: Array.from({ length: 10 }, (_, i) =>
      clip(`a${i}`, { completed: true }),
    ),
    progressSlices: Array.from({ length: 10 }, (_, i) => slice(`a${i}`)),
  });
  assert.ok(summaryA);
  assert.equal(summaryA!.completedCount, 10);
  assert.equal(summaryA!.totalCount, 10);

  const summaryB = buildBatchCompletionSummary({
    sectionIndex: 2,
    clips: [
      ...Array.from({ length: 3 }, (_, i) => clip(`b${i}`, { completed: true })),
      ...Array.from({ length: 7 }, (_, i) => clip(`b${i + 3}`, { completed: false })),
    ],
    progressSlices: [
      ...Array.from({ length: 3 }, (_, i) => slice(`b${i}`)),
      ...Array.from({ length: 7 }, (_, i) =>
        slice(`b${i + 3}`, { completed: false }),
      ),
    ],
  });
  assert.equal(summaryB, null, "incomplete B has no completion summary");
  assert.equal(
    recentBatchFromCompletionSummary(summaryB),
    null,
    "sidebar recentBatch cleared for incomplete B",
  );
  // Returning to A still has A's summary
  assert.equal(summaryA!.sectionIndex, 1);
  assert.equal(recentBatchFromCompletionSummary(summaryA)?.sectionIndex, 1);
}

// Stale-ownership fix is in the client selectBatch path
{
  const src = readFileSync(
    join(process.cwd(), "components/organisms/episodeSections/MovieLearningBatchExperience.tsx"),
    "utf8",
  );
  assert.ok(
    src.includes("recentBatchFromCompletionSummary"),
    "selectBatch must derive recentBatch from selected preview",
  );
  assert.ok(
    !/: prev\.recentBatch/.test(src) && !src.includes(": prev.recentBatch"),
    "must not assign recentBatch from previous sidebar state",
  );
  assert.ok(
    !src.includes("sectionXp: prev.recentBatch"),
    "must not reuse XP from a previous batch",
  );
  assert.ok(
    !src.includes("BatchCompletionSummaryCard"),
    "main area must not use the celebration summary card",
  );
  assert.ok(
    src.includes("LearningClipCardPreview"),
    "completed batches still show the clip list",
  );
  assert.ok(
    src.includes("pickNextIncompleteBatch"),
    "Continue Learning uses next incomplete batch",
  );
}

// Preview loader exposes completionSummary
{
  const src = readFileSync(
    join(process.cwd(), "lib/learning/loadMovieLearningBatchPreview.ts"),
    "utf8",
  );
  assert.ok(src.includes("completionSummary"));
  assert.ok(src.includes("buildBatchCompletionSummary"));
}

// Series episode sections reuse the movie Learning batch experience
{
  const seriesPage = readFileSync(
    join(
      process.cwd(),
      "app/[locale]/(home)/series/[id]/[seasonId]/[episodeId]/sections/page.tsx",
    ),
    "utf8",
  );
  const seriesClient = readFileSync(
    join(
      process.cwd(),
      "components/organisms/episodeSections/EpisodeSectionsPageClient.tsx",
    ),
    "utf8",
  );
  assert.ok(seriesPage.includes("shellMovieLearningBatchPreview"));
  assert.ok(seriesPage.includes("emptyMovieLearningSidebar"));
  assert.ok(seriesClient.includes("MovieLearningBatchExperience"));
  assert.ok(seriesClient.includes("hydrateSidebarOnMount"));
  assert.ok(!seriesClient.includes("hydrateOnMount"));
  assert.ok(seriesClient.includes("/api/episodes/"));
  assert.ok(!seriesClient.includes("<EpisodeSectionsMapClient"));
}

// Sections grid must not rematerialize missing blueprints on first paint
{
  const enrich = readFileSync(
    join(process.cwd(), "lib/learning/enrichBatchesWithPartProgress.ts"),
    "utf8",
  );
  assert.ok(!enrich.includes("getOrMaterializeProgressionSection"));
  assert.ok(!enrich.includes("countQualifiedInSection"));
  const moviePage = readFileSync(
    join(process.cwd(), "app/[locale]/(home)/movies/[id]/sections/page.tsx"),
    "utf8",
  );
  assert.ok(moviePage.includes("shellMovieLearningBatchPreview"));
  assert.ok(!moviePage.includes("loadMovieLearningBatchPreview("));
}

console.log("batchCompletionSummary.validation.ts: ok");
