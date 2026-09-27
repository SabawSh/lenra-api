/**
 * Incremental-hypothesis overlap supersession — run with:
 *   npx tsx helper/puzzel/uiFinalSnapshot.incrementalOverlap.validation.ts
 *
 * Regression: with the board below, saying "The mice asked" once selected only
 * `The` + `mice` (reading as "The mice" on screen). Saying it a second time
 * finally selected `The mice asked`.
 *
 *   preview "the"             → no candidate (deferred, `The` is a prefix)
 *   preview "the mice"        → `mice` exact T1 at token 1, committed definitively
 *   preview "the mice asked"  → `The mice asked` needs span [0,2], which overlaps
 *                               the hard-owned token 1 → no candidate at all
 *
 * The commitment was made at the one moment the evidence was guaranteed to be
 * incomplete: a two-token hypothesis cannot match a three-token tile, so the
 * short tile had no competition. `refreshProvisionalPrefixFlags` did not protect
 * it because it keyed on proper token prefixes, and "mice" sits *inside*
 * "The mice asked" without starting it — invisible to a prefix test. The commit
 * eviction path had the same blind spot.
 *
 * Both now use containment. A placed tile stays provisional (visible, but not
 * hard-owning its tokens) while a longer unsolved tile could still cover its
 * span, and the longer tile evicts it on commit.
 *
 * Verified through the real session/UI path (buildUiFinalSnapshot +
 * appendPlacements), stepping the hypothesis exactly as recognition does.
 */
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import {
  containedTokenOffsets,
  isAmbiguousOverlapSpan,
  longerOverlapExtensions,
} from "@/helper/voiceMatching/prefixAmbiguity";
import { tokenizeTileText } from "@/helper/voiceMatching/textUtils";
import type { PlacementCommitmentLevel } from "@/helper/voiceMatching/types";
import type { PuzzlePart } from "@/types/puzzle";
import { createEmptySessionPlacementState } from "./sessionPlacementState";
import { buildUiFinalSnapshot } from "./uiFinalSnapshot";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── Layer 1: the containment predicate ──────────────────────────────────────

const PHRASE = tokenizeTileText("The mice asked");

assert(
  containedTokenOffsets(tokenizeTileText("mice"), PHRASE).join() === "1",
  "interior overlap: 'mice' sits at offset 1 of 'the mice asked'",
);
assert(
  containedTokenOffsets(tokenizeTileText("The"), PHRASE).join() === "0",
  "prefix overlap: 'the' sits at offset 0",
);
assert(
  containedTokenOffsets(tokenizeTileText("asked"), PHRASE).join() === "2",
  "suffix overlap: 'asked' sits at offset 2",
);
assert(
  containedTokenOffsets(tokenizeTileText("The mice"), PHRASE).join() === "0",
  "phrase overlap: 'the mice' sits at offset 0",
);
assert(
  containedTokenOffsets(PHRASE, PHRASE).length === 0,
  "a tile never contains itself — containment must be strict",
);
assert(
  containedTokenOffsets(tokenizeTileText("circus"), PHRASE).length === 0,
  "unrelated text is not contained",
);

function ambiguous(tileText: string, start: number, transcript: string): boolean {
  const tileTokens = tokenizeTileText(tileText);
  return isAmbiguousOverlapSpan({
    span: { start, end: start + tileTokens.length - 1 },
    transcript: tokenize(normalizeText(transcript)),
    extensions: longerOverlapExtensions({
      tileTokens,
      tileId: "short",
      otherTiles: [{ id: "long", text: "The mice asked" }],
    }),
  });
}

// The longer reading is still alive: "the mice" agrees and "asked" may follow.
assert(ambiguous("mice", 1, "the mice"), "'the mice' keeps 'The mice asked' alive");
// Already spelled out in full — the longer tile should take the span.
assert(
  ambiguous("mice", 1, "the mice asked"),
  "the complete phrase keeps the short tile provisional so it can be superseded",
);
// Dead: the longer phrase would need a "the" that was never spoken.
assert(
  !ambiguous("mice", 0, "mice"),
  "a bare 'mice' cannot hold open a phrase that must start earlier",
);
// Dead: the transcript covers where the phrase would sit and contradicts it.
assert(
  !ambiguous("mice", 1, "a mice ran"),
  "'a mice ran' contradicts 'the mice asked' and must not defer",
);

// The "really really busy" guarantee: a repeated word does not hold itself open.
assert(
  !isAmbiguousOverlapSpan({
    span: { start: 0, end: 0 },
    transcript: tokenize(normalizeText("really really busy")),
    extensions: longerOverlapExtensions({
      tileTokens: tokenizeTileText("really"),
      tileId: "short",
      otherTiles: [{ id: "long", text: "really busy" }],
    }),
  }),
  "the first 'really' of 'really really busy' is already disambiguated",
);

// ── Layer 2: the real session / UI placement path ───────────────────────────

type Step = {
  transcript: string;
  level: PlacementCommitmentLevel;
  expect: readonly string[];
};

function replay(
  name: string,
  tileTexts: readonly string[],
  steps: readonly Step[],
): void {
  const tiles = tileTexts.map((text, index) => ({
    id: `t${index}`,
    text,
  })) as unknown as PuzzlePart[];
  const tileTextById = new Map(tiles.map((tile) => [tile.id, tile.text]));
  let placement = createEmptySessionPlacementState();

  steps.forEach((step, index) => {
    const result = buildUiFinalSnapshot({
      sessionId: 1,
      utteranceKey: `${name}#${index}`,
      transcriptTokens: tokenize(normalizeText(step.transcript)),
      voicePool: tiles.filter((tile) => !placement.placedTiles.has(tile.id)),
      originalParts: tiles,
      tileTextById,
      priorPlacement: placement,
      commitmentLevel: step.level,
    });
    placement = result.placementState;

    const actual = result.snapshot.orderedTiles.map((tile) => tile.text);
    assert(
      actual.length === step.expect.length &&
        actual.every((text, position) => text === step.expect[position]),
      `${name} step ${index} (${step.level} "${step.transcript}"): expected [${step.expect.join(
        " | ",
      )}] but got [${actual.join(" | ")}]`,
    );
  });
}

/** The board from the reported reproduction. */
const BOARD = [
  "The mice asked",
  "The jumping",
  "The",
  "you message",
  "mice",
  "me to give",
];

/** How recognition actually grows a hypothesis for this sentence. */
const GROWING: readonly Step[] = [
  { transcript: "the", level: "preview", expect: [] },
  { transcript: "the mice", level: "preview", expect: ["mice"] },
  { transcript: "the mice asked", level: "preview", expect: ["The mice asked"] },
  { transcript: "the mice asked", level: "final", expect: ["The mice asked"] },
];

// The reported bug, on the real board — correct on the FIRST utterance.
replay("reported board, incremental", BOARD, GROWING);

// Saying it again must be idempotent, never regress to the short tiles.
replay("reported board, repeated utterance", BOARD, [
  ...GROWING,
  { transcript: "the mice asked", level: "preview", expect: ["The mice asked"] },
  { transcript: "the mice asked", level: "final", expect: ["The mice asked"] },
]);

// A. Phrase overlap: "The mice" is a prefix of "The mice asked".
replay("A phrase overlap", ["The mice asked", "The mice"], [
  { transcript: "the", level: "preview", expect: [] },
  { transcript: "the mice", level: "preview", expect: [] },
  { transcript: "the mice asked", level: "preview", expect: ["The mice asked"] },
  { transcript: "the mice asked", level: "final", expect: ["The mice asked"] },
]);

// B. Interior overlap: "mice" sits inside "The mice asked".
replay("B interior overlap", ["The mice asked", "mice"], GROWING);

// Suffix overlap.
replay("B2 suffix overlap", ["me to give", "give"], [
  { transcript: "me", level: "preview", expect: [] },
  { transcript: "me to", level: "preview", expect: [] },
  { transcript: "me to give", level: "preview", expect: ["me to give"] },
  { transcript: "me to give", level: "final", expect: ["me to give"] },
]);

// C. Static final transcript, tile alone.
replay("C static, tile alone", ["The mice asked"], [
  { transcript: "the mice asked", level: "final", expect: ["The mice asked"] },
]);

// D. Static final transcript with competing tiles.
replay("D static, competing tiles", ["The mice asked", "mice"], [
  { transcript: "the mice asked", level: "final", expect: ["The mice asked"] },
]);
replay("D2 static, full board", BOARD, [
  { transcript: "the mice asked", level: "final", expect: ["The mice asked"] },
]);

// E. The existing mud regression must be untouched.
replay("E mud prefix supersession", ["mud facials", "mud"], [
  { transcript: "mud", level: "preview", expect: [] },
  { transcript: "mud", level: "final", expect: ["mud"] },
  { transcript: "mud facials", level: "preview", expect: ["mud facials"] },
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
]);
replay("E2 mud stays when nothing extends it", ["mud facials", "mud"], [
  { transcript: "mud mud facials", level: "final", expect: ["mud", "mud facials"] },
]);

// F. Legitimate short standalone matches must not be delayed or flickered:
// visible on the very first preview, and never withheld.
replay("F1 standalone short tile", ["The mice asked", "mice"], [
  { transcript: "mice", level: "preview", expect: ["mice"] },
  { transcript: "mice", level: "final", expect: ["mice"] },
]);
replay("F2 short tile in a contradicting sentence", ["The mice asked", "mice"], [
  { transcript: "a mice ran", level: "preview", expect: ["mice"] },
  { transcript: "a mice ran", level: "final", expect: ["mice"] },
]);
// The speaker stops mid-phrase: the short tile must stay on screen, not vanish.
replay("F3 speaker stops mid-phrase", ["The mice asked", "mice"], [
  { transcript: "the", level: "preview", expect: [] },
  { transcript: "the mice", level: "preview", expect: ["mice"] },
  { transcript: "the mice", level: "final", expect: ["mice"] },
]);
// Repeated tiles must not be collapsed into one.
replay("F4 repeated tiles", ["mice", "mice"], [
  { transcript: "mice mice", level: "final", expect: ["mice", "mice"] },
]);
// Both the short tile and the phrase are genuinely spoken, in order.
replay("F5 short tile then phrase", ["The mice asked", "mice"], [
  {
    transcript: "mice the mice asked",
    level: "final",
    expect: ["mice", "The mice asked"],
  },
]);

console.log("uiFinalSnapshot.incrementalOverlap.validation: all passed");
