/**
 * Sticky longest-literal-prefix eviction — run with:
 *   npx tsx helper/puzzel/sessionPlacementState.literalPrefix.validation.ts
 *
 * Covers the live multi-pass bug: Chrome/final commits short "I", then
 * "I almost" must replace it instead of stacking both in the UI.
 * Also covers the inverse: sticky "I almost" then Chrome shrink → short "I".
 */
import {
  appendPlacements,
  consumedSpansFromSessionState,
  createEmptySessionPlacementState,
  preparePriorPlacementForMatching,
  purgeDetachedPlacements,
  type PlacementProposal,
  type SessionPlacementState,
} from "./sessionPlacementState";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function proposal(
  tileId: string,
  start: number,
  end: number,
  tileTokenCount: number,
): PlacementProposal {
  const indices: number[] = [];
  for (let index = start; index <= end; index++) indices.push(index);
  return {
    tileId,
    matchedSpan: { start, end },
    matchedTokenIndices: indices,
    tileTokenCount,
    confidence: 1,
    source: "strict",
  };
}

function placeShortI(): SessionPlacementState {
  const empty = createEmptySessionPlacementState();
  const tileTextById = new Map([
    ["tile-i", "I"],
    ["tile-i-almost", "I almost"],
  ]);
  return appendPlacements(empty, [proposal("tile-i", 0, 0, 1)], {
    transcriptTokens: ["i"],
    tileTextById,
  });
}

{
  const prior = placeShortI();
  assert(prior.placedTiles.has("tile-i"), "setup: short I must be sticky");

  const tileTextById = new Map([
    ["tile-i", "I"],
    ["tile-i-almost", "I almost"],
  ]);
  const next = appendPlacements(
    prior,
    [proposal("tile-i-almost", 0, 1, 2)],
    {
      transcriptTokens: ["i", "almost"],
      tileTextById,
    },
  );

  assert(
    !next.placedTiles.has("tile-i"),
    "sticky short I must be evicted when I almost arrives",
  );
  assert(
    next.placedTiles.has("tile-i-almost"),
    "I almost must commit after eviction",
  );
  const span = next.placedTiles.get("tile-i-almost")!.matchedSpan;
  assert(
    span.start === 0 && span.end === 1,
    `I almost span expected [0,1], got [${span.start},${span.end}]`,
  );
}

{
  // Detached sticky short must also be evicted by text-prefix alone.
  const prior = placeShortI();
  const sticky = prior.placedTiles.get("tile-i")!;
  prior.placedTiles.set("tile-i", {
    ...sticky,
    matchedSpan: { start: -1, end: -1 },
    matchedTokenIndices: [],
  });

  const tileTextById = new Map([
    ["tile-i", "I"],
    ["tile-i-almost", "I almost"],
  ]);
  const next = appendPlacements(
    prior,
    [proposal("tile-i-almost", 0, 1, 2)],
    {
      transcriptTokens: ["i", "almost"],
      tileTextById,
    },
  );

  assert(
    !next.placedTiles.has("tile-i"),
    "detached sticky I must be evicted by text prefix",
  );
  assert(
    next.placedTiles.has("tile-i-almost"),
    "I almost must commit when sticky I was detached",
  );
}

{
  // Unrelated sticky must not be evicted ("go" vs "I almost").
  const empty = createEmptySessionPlacementState();
  const tileTextById = new Map([
    ["tile-go", "go"],
    ["tile-i-almost", "I almost"],
  ]);
  const withGo = appendPlacements(empty, [proposal("tile-go", 0, 0, 1)], {
    transcriptTokens: ["go"],
    tileTextById,
  });
  const next = appendPlacements(
    withGo,
    [proposal("tile-i-almost", 1, 2, 2)],
    {
      transcriptTokens: ["go", "i", "almost"],
      tileTextById,
    },
  );
  assert(next.placedTiles.has("tile-go"), "unrelated sticky go must remain");
  assert(next.placedTiles.has("tile-i-almost"), "I almost must still append");
}

{
  // After I almost is sticky, a later short I on the same evidence must not stack.
  const empty = createEmptySessionPlacementState();
  const tileTextById = new Map([
    ["tile-i", "I"],
    ["tile-i-almost", "I almost"],
  ]);
  const withLong = appendPlacements(
    empty,
    [proposal("tile-i-almost", 0, 1, 2)],
    {
      transcriptTokens: ["i", "almost"],
      tileTextById,
    },
  );
  const stacked = appendPlacements(withLong, [proposal("tile-i", 0, 0, 1)], {
    transcriptTokens: ["i", "almost"],
    tileTextById,
  });
  assert(stacked.placedTiles.has("tile-i-almost"), "I almost must remain");
  assert(
    !stacked.placedTiles.has("tile-i"),
    "short I must not append under sticky I almost",
  );
}

{
  // Chrome shrinks "I almost" → "I": keep prefix lock so short I cannot steal.
  const empty = createEmptySessionPlacementState();
  const tileTextById = new Map([
    ["tile-i", "I"],
    ["tile-i-almost", "I almost"],
  ]);
  const withLong = appendPlacements(
    empty,
    [proposal("tile-i-almost", 0, 1, 2)],
    {
      transcriptTokens: ["i", "almost"],
      tileTextById,
    },
  );
  const shrunk = preparePriorPlacementForMatching(
    withLong,
    ["i"],
    tileTextById,
  );
  assert(
    shrunk.placedTiles.has("tile-i-almost"),
    "I almost must stay selected after shrink",
  );
  const held = shrunk.placedTiles.get("tile-i-almost")!.matchedSpan;
  assert(
    held.start === 0 && held.end === 0,
    `expected prefix hold [0,0] after shrink, got [${held.start},${held.end}]`,
  );
  assert(
    consumedSpansFromSessionState(shrunk).length === 1,
    "prefix hold must still consume tokens",
  );

  const afterShrink = appendPlacements(shrunk, [proposal("tile-i", 0, 0, 1)], {
    transcriptTokens: ["i"],
    tileTextById,
  });
  assert(
    !afterShrink.placedTiles.has("tile-i"),
    "short I must not stack after Chrome shrinks I almost → I",
  );

  // Phrase returns — expand lock back to full span.
  const grown = preparePriorPlacementForMatching(
    shrunk,
    ["i", "almost"],
    tileTextById,
  );
  const full = grown.placedTiles.get("tile-i-almost")!.matchedSpan;
  assert(
    full.start === 0 && full.end === 1,
    `expected full span [0,1] after grow, got [${full.start},${full.end}]`,
  );
}

{
  // Sticky multipass: earlier "he's in his study" then full transcript must
  // reorder commitSeq to speech order (Will Go On first).
  const tileTextById = new Map([
    ["will", "Will Go On"],
    ["study", "he's in his study"],
  ]);
  const passA = appendPlacements(
    createEmptySessionPlacementState(),
    [proposal("study", 0, 3, 4)],
    {
      transcriptTokens: ["hes", "in", "his", "study"],
      tileTextById,
    },
  );
  assert(
    [...passA.placedTiles.values()][0]?.commitSeq === 0,
    "pass A study commitSeq 0",
  );

  // preparePrior-like rebind of study to [3,6] before append in real pipeline;
  // simulate rebound sticky then append will.
  const rebound = preparePriorPlacementForMatching(
    passA,
    ["will", "go", "on", "hes", "in", "his", "study"],
    tileTextById,
  );
  const passB = appendPlacements(
    rebound,
    [proposal("will", 0, 2, 3)],
    {
      transcriptTokens: ["will", "go", "on", "hes", "in", "his", "study"],
      tileTextById,
    },
  );
  const ordered = [...passB.placedTiles.values()].sort(
    (left, right) => (left.commitSeq ?? 0) - (right.commitSeq ?? 0),
  );
  assert(
    ordered[0]?.tileId === "will" && ordered[1]?.tileId === "study",
    `expected Will Go On then study by commitSeq, got ${ordered.map((e) => e.tileId).join(",")}`,
  );
  assert(
    ordered[0]!.matchedSpan.start < ordered[1]!.matchedSpan.start,
    "speech starts must follow transcript order after reorder",
  );
}

{
  // Temporary STT regression: "whoever laid" → "who" must detach, not drop.
  // Stronger return must reuse the same placement (no accept/remove flicker).
  // Final still-detached must purge so wrong matches are not forever sticky.
  const tileTextById = new Map([["laid", "whoever laid"]]);
  const committed = appendPlacements(
    createEmptySessionPlacementState(),
    [proposal("laid", 0, 1, 2)],
    {
      transcriptTokens: ["whoever", "laid"],
      tileTextById,
    },
  );
  assert(committed.placedTiles.has("laid"), "setup: whoever laid sticky");

  const weak = preparePriorPlacementForMatching(
    committed,
    ["who"],
    tileTextById,
  );
  assert(
    weak.placedTiles.has("laid"),
    "weak interim must keep whoever laid selected (no flicker drop)",
  );
  const weakSpan = weak.placedTiles.get("laid")!.matchedSpan;
  assert(
    weakSpan.start < 0 || weakSpan.end < weakSpan.start,
    `weak interim must detach span, got [${weakSpan.start},${weakSpan.end}]`,
  );
  assert(
    consumedSpansFromSessionState(weak).length === 0,
    "detached sticky must not reserve transcript tokens",
  );

  const restored = preparePriorPlacementForMatching(
    weak,
    ["whoever", "laid"],
    tileTextById,
  );
  assert(
    restored.placedTiles.has("laid"),
    "stronger hypothesis must reuse same placement id",
  );
  const restoredSpan = restored.placedTiles.get("laid")!.matchedSpan;
  assert(
    restoredSpan.start === 0 && restoredSpan.end === 1,
    `expected re-attach [0,1], got [${restoredSpan.start},${restoredSpan.end}]`,
  );
  assert(
    restored.placedTiles.get("laid")!.commitSeq ===
      committed.placedTiles.get("laid")!.commitSeq,
    "re-attach must keep original commitSeq",
  );

  const purged = purgeDetachedPlacements(weak);
  assert(
    !purged.placedTiles.has("laid"),
    "final purge must remove still-detached wrong/temporary sticky",
  );
}

{
  // Architectural invariant: preparePrior must NOT reject a committed tile when
  // STT compounds "who ever laid" → "whoever laid" (matcher-equivalent).
  // Repair uses the same equality as evaluateTile, not exact findFreeLiteralSpan.
  const tileTextById = new Map([
    ["laid", "Who ever laid"],
    ["eyes", "their eyes"],
    ["coral", "on Coraline"],
  ]);
  const committed = appendPlacements(
    createEmptySessionPlacementState(),
    [proposal("laid", 0, 2, 3)],
    {
      transcriptTokens: ["who", "ever", "laid"],
      tileTextById,
    },
  );
  assert(committed.placedTiles.has("laid"), "setup: Who ever laid sticky");

  const compound = preparePriorPlacementForMatching(
    committed,
    ["whoever", "laid"],
    tileTextById,
  );
  assert(
    compound.placedTiles.has("laid"),
    "compound whoever|laid must keep committed Who ever laid",
  );
  const compoundSpan = compound.placedTiles.get("laid")!.matchedSpan;
  assert(
    compoundSpan.start === 0 && compoundSpan.end === 1,
    `expected matcher-equivalent rebound [0,1], got [${compoundSpan.start},${compoundSpan.end}]`,
  );
  assert(
    compoundSpan.start >= 0,
    "must stay attached (not detach) under whoever↔who ever",
  );

  const grown = preparePriorPlacementForMatching(
    compound,
    ["whoever", "laid", "their", "eyes"],
    tileTextById,
  );
  assert(
    grown.placedTiles.has("laid"),
    "growing transcript must keep Who ever laid attached",
  );
  const grownSpan = grown.placedTiles.get("laid")!.matchedSpan;
  assert(
    grownSpan.start === 0 && grownSpan.end === 1,
    `expected tight span [0,1] not stealing their, got [${grownSpan.start},${grownSpan.end}]`,
  );

  const withEyes = appendPlacements(
    grown,
    [proposal("eyes", 2, 3, 2)],
    {
      transcriptTokens: ["whoever", "laid", "their", "eyes"],
      tileTextById,
    },
  );
  assert(withEyes.placedTiles.has("laid"), "Who ever laid must remain after eyes");
  assert(withEyes.placedTiles.has("eyes"), "their eyes must append");

  const full = preparePriorPlacementForMatching(
    withEyes,
    ["whoever", "laid", "their", "eyes", "on", "coraline"],
    tileTextById,
  );
  const afterFinalPrep = purgeDetachedPlacements(full);
  assert(
    afterFinalPrep.placedTiles.has("laid"),
    "final must NOT purge Who ever laid when matcher-equivalent evidence remains",
  );
}

process.stdout.write("sessionPlacementState.literalPrefix.validation: all passed\n");

