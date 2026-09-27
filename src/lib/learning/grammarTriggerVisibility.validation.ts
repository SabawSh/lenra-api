/**
 * Grammar trigger visibility + drawer close / stale-data rules.
 *
 *   npm run test:grammar-trigger-visibility
 */
import assert from "node:assert/strict";
import type { GrammarForPartsResult } from "./grammarForParts";
import {
  autoOpenGrammarDetailId,
  grammarDataForDisplay,
  shouldCloseGrammarDrawer,
  shouldShowGrammarTrigger,
  unitHasGrammar,
} from "./grammarTriggerVisibility";

function resultWithConcepts(
  ids: { id: string; occurrenceCount: number }[],
): GrammarForPartsResult {
  return {
    grammar: ids.map((c) => ({
      id: c.id,
      titleEn: c.id,
      titleFa: null,
      explanationEn: null,
      explanationFa: null,
      formationEn: null,
      formationFa: null,
      usageEn: null,
      usageFa: null,
      category: null,
      subcategory: null,
      cefrMin: null,
      cefrMax: null,
      catalogExamples: [],
      occurrenceCount: c.occurrenceCount,
      occurrences: Array.from({ length: c.occurrenceCount }, (_, i) => ({
        occurrenceId: `${c.id}-${i}`,
        partId: `part-${i}`,
        partOrder: i + 1,
        partText: "sample",
        evidenceSpan: null,
        confidence: null,
        source: null,
      })),
    })),
  };
}

const withGrammar = resultWithConcepts([
  { id: "present_perfect", occurrenceCount: 1 },
]);
const withGrammarMerged = resultWithConcepts([
  { id: "present_perfect", occurrenceCount: 2 },
  { id: "past_simple", occurrenceCount: 1 },
]);
const empty: GrammarForPartsResult = { grammar: [] };

function main() {
  // 1) One active Part with grammar → trigger visible
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: withGrammar, puzzleResolved: true}),
    true,
  );
  assert.equal(unitHasGrammar(withGrammar), true);

  // 2) One active Part without grammar → trigger hidden
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: empty, puzzleResolved: true}),
    false,
  );
  assert.equal(unitHasGrammar(empty), false);

  // 3) Multiple merged Parts where at least one has grammar → visible
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: withGrammarMerged, puzzleResolved: true}),
    true,
  );

  // 4) Multiple merged Parts with no grammar → hidden
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: empty, puzzleResolved: true}),
    false,
  );

  // Loading / unknown → never show (no flicker of a false-positive flag)
  assert.equal(shouldShowGrammarTrigger({ status: "idle", puzzleResolved: true}), false);
  assert.equal(shouldShowGrammarTrigger({ status: "loading", puzzleResolved: true}), false);
  assert.equal(shouldShowGrammarTrigger({ status: "error", puzzleResolved: true}), false);
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: null, puzzleResolved: true}),
    false,
  );

  // Puzzle not yet answered/solved → never show (even with ready grammar)
  assert.equal(
    shouldShowGrammarTrigger({
      status: "ready",
      data: withGrammar,
      puzzleResolved: false,
    }),
    false,
  );

  // 5) Navigation grammar → non-grammar: trigger disappears
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: withGrammar, puzzleResolved: true}),
    true,
  );
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: empty, puzzleResolved: true}),
    false,
  );

  // 6) Navigation non-grammar → grammar: trigger appears
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: empty, puzzleResolved: true}),
    false,
  );
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: withGrammar, puzzleResolved: true}),
    true,
  );

  // 7) Drawer open + lesson changes to no grammar → drawer closes
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "ready",
      data: empty,
    }),
    true,
  );
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "ready",
      data: withGrammar,
    }),
    false,
  );
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "loading",
      data: null,
    }),
    false,
  );
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "error",
      data: null,
    }),
    true,
  );
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: false,
      status: "ready",
      data: empty,
    }),
    false,
  );
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "ready",
      data: withGrammar,
      puzzleResolved: false,
    }),
    true,
  );

  // 8) No stale grammar from a previous lesson is displayed
  assert.equal(
    grammarDataForDisplay({
      status: "ready",
      data: withGrammar,
      partKey: "part-b",
      dataPartKey: "part-a",
    }),
    null,
  );
  assert.equal(
    grammarDataForDisplay({
      status: "loading",
      data: withGrammar,
      partKey: "part-b",
      dataPartKey: "part-a",
    }),
    null,
  );
  assert.deepEqual(
    grammarDataForDisplay({
      status: "ready",
      data: withGrammar,
      partKey: "part-a",
      dataPartKey: "part-a",
    }),
    withGrammar,
  );

  // Auto-open detail: exactly one concept → that concept id
  assert.equal(autoOpenGrammarDetailId(withGrammar), "present_perfect");
  assert.equal(autoOpenGrammarDetailId(withGrammarMerged), null);
  assert.equal(autoOpenGrammarDetailId(empty), null);
  assert.equal(autoOpenGrammarDetailId(null), null);
  assert.equal(
    autoOpenGrammarDetailId(
      resultWithConcepts([{ id: "ghost", occurrenceCount: 0 }]),
    ),
    null,
  );

  // Zero grammar → trigger hidden (unchanged)
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: empty, puzzleResolved: true}),
    false,
  );

  console.log("grammarTriggerVisibility: ok");
}

main();
