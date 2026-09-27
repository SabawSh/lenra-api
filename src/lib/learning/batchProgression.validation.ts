/**
 *   npx tsx lib/learning/batchProgression.validation.ts
 */
import assert from "node:assert/strict";
import {
  firstIncompleteCanonicalStep,
  firstIncompleteClipIndexFromCards,
  firstIncompleteIndex,
} from "./batchProgression";
import { resolvePlayableSessionStart } from "./sectionDisplaySessionState";
import { resolveLearnPlayerStart } from "./resolveLearnPlayerStart";
import type { SectionDisplaySlot } from "./buildSectionDisplaySession";

function slot(kind: SectionDisplaySlot["displayKind"], id: string): SectionDisplaySlot {
  return {
    displayKind: kind,
    unit: {
      parts: [{ id }],
      metrics: { difficulty: 0, wordCount: 0, speechDurationMs: 0 },
      targetZone: "near",
    },
  } as SectionDisplaySlot;
}

function progress(completed: boolean) {
  return completed
    ? {
        bestScore: 90,
        completedAt: new Date(),
        attempts: 1,
        wrongMoves: 0,
      }
    : { bestScore: 0, completedAt: null, attempts: 0, wrongMoves: 0 };
}

function main() {
  const partIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  const byId = new Map(
    partIds.map((id, i) => {
      const completed = i === 0 || i === 1 || i === 2 || i === 6;
      return [id, progress(completed)] as const;
    }),
  );

  assert.equal(firstIncompleteCanonicalStep(partIds, byId), 4);

  const cards = partIds.map((_, i) => ({
    clipIndex: i + 1,
    completed: i === 0 || i === 1 || i === 2 || i === 6,
  }));
  assert.equal(firstIncompleteClipIndexFromCards(cards, 1), 4);
  assert.equal(firstIncompleteIndex(cards), 3);

  const composed = [
    slot("completed", "p1"),
    slot("completed", "p2"),
    slot("completed", "p3"),
    slot("new", "p4"),
    slot("new", "p5"),
    slot("new", "p6"),
    slot("completed", "p7"),
  ];
  const playable = composed.filter((s) => s.displayKind !== "completed") as {
    displayKind: "new";
    unit: SectionDisplaySlot["unit"];
  }[];

  const atSix = resolvePlayableSessionStart({
    composedDisplaySlots: composed,
    playableSlots: playable,
    requestedCanonicalStep: 6,
  });
  assert.equal(
    atSix.playableIndex0,
    0,
    "later incomplete canonical step must fall back to first incomplete",
  );
  assert.equal(atSix.canonicalStep, 4);

  const clampBug = resolveLearnPlayerStart({
    displaySession: {
      composedDisplaySlots: composed,
      displaySlots: playable,
      sessionSlots: playable,
      learningUnits: [],
      visibleStepCount: playable.length,
    },
    requestedCanonicalStep: 6,
    legacyPlaylistLength: playable.length,
  });
  assert.equal(clampBug.initialUnitIndex, 0);
  assert.equal(clampBug.canonicalStep, 4);

  const atFour = resolvePlayableSessionStart({
    composedDisplaySlots: composed,
    playableSlots: playable,
    requestedCanonicalStep: 4,
  });
  assert.equal(atFour.playableIndex0, 0);
  assert.equal(atFour.canonicalStep, 4);

  console.log("batchProgression.validation: ok");
}

main();
