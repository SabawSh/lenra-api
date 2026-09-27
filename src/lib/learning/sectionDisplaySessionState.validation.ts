/**
 *   npm run test:section-display-session-state
 */
import assert from "node:assert/strict";
import { dedupeClipCardsByPartId } from "./batchClipDedupe";
import {
  composeBatchDisplayItems,
  SECTION_DISPLAY_CAPACITY,
} from "./sectionDisplayComposition";
import type { SectionDisplaySlot } from "./buildSectionDisplaySession";
import {
  clipCardStateForSessionSlot,
  countComposedDisplaySlotKinds,
  countSessionSlotDisplayKinds,
  playableDisplaySlotsFromComposed,
  resolvePlayableSessionStart,
} from "./sectionDisplaySessionState";

function slot(kind: SectionDisplaySlot["displayKind"], id: string): SectionDisplaySlot {
  return {
    displayKind: kind,
    unit: { parts: [{ id }], metrics: { difficulty: 0, wordCount: 0, speechDurationMs: 0 }, targetZone: "near" },
  } as SectionDisplaySlot;
}

function playableKinds(composed: SectionDisplaySlot[]) {
  return playableDisplaySlotsFromComposed(composed).map((s) => s.displayKind);
}

function main() {
  // Play playlist: remove completed only, preserve order (no sort by kind).
  assert.deepEqual(
    playableKinds([
      slot("completed", "c1"),
      slot("new", "n1"),
      slot("review", "r1"),
      slot("completed", "c2"),
      slot("new", "n2"),
    ]),
    ["new", "review", "new"],
  );
  assert.deepEqual(
    playableKinds([slot("new", "n1"), slot("review", "r1"), slot("new", "n2")]),
    ["new", "review", "new"],
  );
  assert.deepEqual(
    playableKinds([slot("review", "r1"), slot("new", "n1"), slot("new", "n2")]),
    ["review", "new", "new"],
  );
  assert.deepEqual(
    playableKinds([
      slot("completed", "c1"),
      slot("completed", "c2"),
      slot("new", "n1"),
      slot("review", "r1"),
      slot("completed", "c3"),
      slot("new", "n2"),
    ]),
    ["new", "review", "new"],
  );
  assert.equal(playableDisplaySlotsFromComposed([slot("completed", "c1")]).length, 0);

  const summary = countComposedDisplaySlotKinds([
    slot("completed", "c1"),
    slot("new", "n1"),
    slot("review", "r1"),
    slot("completed", "c2"),
    slot("new", "n2"),
  ]);
  assert.deepEqual(summary, {
    completed: 2,
    new: 2,
    review: 1,
    total: 5,
    playable: 3,
  });
  assert.deepEqual(
    playableKinds([
      slot("completed", "c1"),
      slot("new", "n1"),
      slot("review", "r1"),
      slot("completed", "c2"),
      slot("new", "n2"),
    ]),
    ["new", "review", "new"],
  );

  const batch = composeBatchDisplayItems({
    sections: [
      {
        sectionIndex: 1,
        progressionUnits: Array.from({ length: 10 }, (_, i) => ({
          unitKey: `u${i + 1}`,
        })),
      },
    ],
    targetSectionIndex: 1,
    isUnitComplete: () => false,
  });
  const incompleteKinds = batch
    .filter((i) => i.type !== "completed")
    .map((i) => (i.type === "review" ? "review" : "new"));
  assert.equal(incompleteKinds.length, SECTION_DISPLAY_CAPACITY);
  assert.equal(incompleteKinds.filter((k) => k === "review").length, 0);
  assert.equal(incompleteKinds.filter((k) => k === "new").length, 10);

  const prior = [
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
  const s1 = composeBatchDisplayItems({
    sections: prior,
    targetSectionIndex: 1,
    isUnitComplete: () => false,
  });
  const s2 = composeBatchDisplayItems({
    sections: prior,
    targetSectionIndex: 2,
    isUnitComplete: () => false,
  });
  assert.equal(s1.filter((i) => i.type === "review").length, 0);
  assert.equal(s2.filter((i) => i.type === "review").length, 0);
  assert.equal(s1.length, SECTION_DISPLAY_CAPACITY);
  assert.equal(s2.length, SECTION_DISPLAY_CAPACITY);

  assert.equal(
    clipCardStateForSessionSlot({ displayKind: "review" }, true),
    "review",
  );
  assert.equal(
    clipCardStateForSessionSlot({ displayKind: "new" }, true),
    "completed",
  );
  assert.equal(
    clipCardStateForSessionSlot({ displayKind: "new" }, false),
    "new",
  );

  const kinds = countSessionSlotDisplayKinds([
    { displayKind: "new" },
    { displayKind: "review" },
    { displayKind: "new" },
  ]);
  assert.deepEqual(kinds, { new: 2, review: 1, total: 3 });

  const deduped = dedupeClipCardsByPartId([
    { partId: "p1", state: "new", clipIndex: 1 },
    { partId: "p1", state: "review", clipIndex: 2 },
  ] as const);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]!.state, "review");

  console.log("sectionDisplaySessionState: ok");
}

main();
