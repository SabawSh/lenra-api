/**
 *   npm run test:composed-batch-progress
 */
import assert from "node:assert/strict";
import {
  buildPlayableStepByPartId,
  isComposedBatchItemComplete,
} from "./composedBatchProgress";

function slot(
  kind: "completed" | "new" | "review",
  partId: string,
): { displayKind: typeof kind; unit: { parts: { id: string }[] } } {
  return { displayKind: kind, unit: { parts: [{ id: partId }] } };
}

function countComplete(params: {
  sectionIndex: number;
  slots: ReturnType<typeof slot>[];
  due: Set<string>;
  progress: Record<
    string,
    {
      bestScore: number;
      completedAt: Date;
      lastScore?: number;
      sessionSectionIndex?: number;
      visibleUnitStep?: number;
    }
  >;
}) {
  const steps = buildPlayableStepByPartId(params.slots);
  let n = 0;
  for (const s of params.slots) {
    const partId = s.unit.parts[0]!.id;
    const inComp = s.displayKind === "completed";
    const displayKind =
      s.displayKind === "completed" ? undefined : s.displayKind;
    if (
      isComposedBatchItemComplete({
        inCompositionCompletedSet: inComp,
        displayKind,
        partId,
        batchSectionIndex: params.sectionIndex,
        dueTodayPartIds: params.due,
        progress: params.progress[partId] ?? null,
        playableStepByPartId: steps,
      })
    ) {
      n += 1;
    }
  }
  return n;
}

function main() {
  const due = new Set(["r1"]);
  const now = new Date();

  // Test 1 — 9 completed + 1 review → 10 after review session
  const batch1 = [
    ...Array.from({ length: 9 }, (_, i) => slot("completed", `c${i}`)),
    slot("review", "r1"),
  ];
  const before1 = countComplete({
    sectionIndex: 4,
    slots: batch1,
    due,
    progress: {
      r1: { bestScore: 80, completedAt: now, lastScore: 0 },
    },
  });
  assert.equal(before1, 9);

  const after1 = countComplete({
    sectionIndex: 4,
    slots: batch1,
    due,
    progress: {
      r1: {
        bestScore: 80,
        completedAt: now,
        lastScore: 90,
        sessionSectionIndex: 4,
        visibleUnitStep: 1,
      },
    },
  });
  assert.equal(after1, 10);

  // Test 4 — historically complete unit, review still incomplete until session
  const batch4 = [
    ...Array.from({ length: 9 }, (_, i) => slot("completed", `c${i}`)),
    slot("review", "r1"),
  ];
  const stalePlacement = countComplete({
    sectionIndex: 4,
    slots: batch4,
    due,
    progress: {
      r1: {
        bestScore: 95,
        completedAt: now,
        lastScore: 95,
        sessionSectionIndex: 2,
        visibleUnitStep: 3,
      },
    },
  });
  assert.equal(stalePlacement, 9);

  // Test 2 — 8 completed + 2 reviews
  const batch2 = [
    ...Array.from({ length: 8 }, (_, i) => slot("completed", `c${i}`)),
    slot("review", "r1"),
    slot("review", "r2"),
  ];
  const steps2 = buildPlayableStepByPartId(batch2);
  assert.equal(steps2.get("r1"), 1);
  assert.equal(steps2.get("r2"), 2);

  const mid2 = countComplete({
    sectionIndex: 1,
    slots: batch2,
    due: new Set(["r1", "r2"]),
    progress: {
      r1: {
        bestScore: 70,
        completedAt: now,
        lastScore: 70,
        sessionSectionIndex: 1,
        visibleUnitStep: 1,
      },
      r2: { bestScore: 0, completedAt: now, lastScore: 0 },
    },
  });
  assert.equal(mid2, 9);

  // Test 3 — 7 completed + 2 new + 1 review
  const batch3 = [
    ...Array.from({ length: 7 }, (_, i) => slot("completed", `c${i}`)),
    slot("new", "n1"),
    slot("new", "n2"),
    slot("review", "r1"),
  ];
  const steps3 = buildPlayableStepByPartId(batch3);
  assert.equal(steps3.get("n1"), 1);
  assert.equal(steps3.get("n2"), 2);
  assert.equal(steps3.get("r1"), 3);

  console.log("composedBatchProgress: ok");
}

main();
