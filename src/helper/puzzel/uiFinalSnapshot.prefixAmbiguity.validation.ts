/**
 * Prefix/overlap ambiguity regression matrix — run with:
 *   npx tsx helper/puzzel/uiFinalSnapshot.prefixAmbiguity.validation.ts
 *
 * Drives the real STT → matcher → resolver → placement → UI pipeline over a
 * sequence of hypotheses, so it covers the live multi-pass bug: an engine
 * "final" arriving mid-utterance committed short "mud" and hard-reserved its
 * token, after which "mud facials" was rejected as OVERLAP_CONSUMED forever.
 *
 * Guards, in both directions:
 *  - an ambiguous prefix commit stays supersedable by a real continuation
 *  - a disambiguated commit ("mud mud facials") keeps standalone ownership
 *  - spoken order stays authoritative; caption order is never used to reorder
 *  - previously committed tiles do not flicker on weaker interim hypotheses
 */
import type { PuzzlePart } from "@/types/puzzle";
import {
  createEmptySessionPlacementState,
  type SessionPlacementState,
} from "./sessionPlacementState";
import { buildUiFinalSnapshot } from "./uiFinalSnapshot";
import type { PlacementCommitmentLevel } from "@/helper/voiceMatching/types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function part(id: string, text: string): PuzzlePart {
  return { id, text } as PuzzlePart;
}

/** Tile set from the product report, plus unrelated tiles as distractors. */
const MUD_TILES: readonly PuzzlePart[] = [
  part("t-mud", "mud"),
  part("t-mud-facials", "mud facials"),
  part("t-mud-baths", "mud baths"),
  part("t-mud-pies", "mud pies"),
  part("t-for", "for"),
  part("t-its-great", "It's great"),
  part("t-poison-oak", "poison oak"),
];

type Step = {
  transcript: string;
  level: PlacementCommitmentLevel;
  /** Expected visible tile texts in UI order, or undefined to skip the check. */
  expect?: readonly string[];
};

let passCount = 0;

/**
 * Replays hypotheses through one voice session, threading placement state the
 * way production does (priorPlacement ← previous placementState).
 */
function replay(name: string, tiles: readonly PuzzlePart[], steps: readonly Step[]): void {
  const tileTextById = new Map(tiles.map((tile) => [tile.id, tile.text]));
  let placement: SessionPlacementState = createEmptySessionPlacementState();

  steps.forEach((step, index) => {
    const transcriptTokens = step.transcript.split(" ").filter(Boolean);
    const result = buildUiFinalSnapshot({
      sessionId: 1,
      utteranceKey: `${name}#${index}`,
      transcriptTokens,
      voicePool: tiles.filter((tile) => !placement.placedTiles.has(tile.id)),
      originalParts: tiles,
      tileTextById,
      priorPlacement: placement,
      commitmentLevel: step.level,
    });
    placement = result.placementState;

    if (!step.expect) return;
    const actual = result.snapshot.orderedTiles.map((tile) => tile.text);
    assert(
      actual.length === step.expect.length &&
        actual.every((text, position) => text === step.expect![position]),
      `${name} step ${index} (${step.level} "${step.transcript}"): expected [${step.expect.join(
        " | ",
      )}] but got [${actual.join(" | ")}]`,
    );
  });

  passCount += 1;
}

// 1. "mud" alone commits and stays selected — no continuation ever arrives.
replay("mud → mud", MUD_TILES, [
  { transcript: "mud", level: "final", expect: ["mud"] },
]);

// 2. Whole phrase in one hypothesis — only the longer tile is committed.
replay("mud facials → mud facials", MUD_TILES, [
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
]);

// 3–4. Same for the other overlapping extensions (general rule, not "facials").
replay("mud baths → mud baths", MUD_TILES, [
  { transcript: "mud baths", level: "final", expect: ["mud baths"] },
]);
replay("mud pies → mud pies", MUD_TILES, [
  { transcript: "mud pies", level: "final", expect: ["mud pies"] },
]);

// 5. THE REPORTED BUG: engine emits a final for "mud" while the user is still
// speaking. The prefix commit must remain supersedable by the continuation.
replay("mid-utterance final mud then mud facials", MUD_TILES, [
  { transcript: "mud", level: "final", expect: ["mud"] },
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
]);

// Same through the preview path (interim hypotheses growing).
replay("preview growth mud → mud facials", MUD_TILES, [
  { transcript: "mud", level: "preview", expect: [] },
  { transcript: "mud facials", level: "preview", expect: ["mud facials"] },
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
]);

// 6. "mud mud facials" — the first occurrence is disambiguated by the next
// spoken token and must keep standalone ownership.
replay("mud mud facials → mud + mud facials", MUD_TILES, [
  { transcript: "mud", level: "preview" },
  { transcript: "mud mud", level: "preview", expect: ["mud"] },
  { transcript: "mud mud facials", level: "final", expect: ["mud", "mud facials"] },
]);

// Same sentence when the first "mud" was already committed by an early final.
replay("final mud then mud mud facials", MUD_TILES, [
  { transcript: "mud", level: "final", expect: ["mud"] },
  { transcript: "mud mud facials", level: "final", expect: ["mud", "mud facials"] },
]);

// 7. Reverse order — longer phrase first, standalone second. Spoken order kept.
replay("mud facials mud → mud facials + mud", MUD_TILES, [
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
  { transcript: "mud facials mud", level: "final", expect: ["mud facials", "mud"] },
]);

// 8. Repeated identical words with two distinct extensions — occurrence
// identity and consumed-span ownership must not cross over.
replay("mud baths mud pies", MUD_TILES, [
  { transcript: "mud", level: "final", expect: ["mud"] },
  { transcript: "mud baths", level: "final", expect: ["mud baths"] },
  {
    transcript: "mud baths mud pies",
    level: "final",
    expect: ["mud baths", "mud pies"],
  },
]);

// 9. Overlapping multi-token tiles where the prefix itself is multi-token.
{
  const tiles: readonly PuzzlePart[] = [
    part("t-poison", "poison oak"),
    part("t-poison-long", "poison oak rash"),
    part("t-for", "for"),
  ];
  replay("poison oak → poison oak rash", tiles, [
    { transcript: "poison oak", level: "final", expect: ["poison oak"] },
    {
      transcript: "poison oak rash",
      level: "final",
      expect: ["poison oak rash"],
    },
  ]);
}

// 10. Hypothesis shrink then re-growth must not lose the tile.
replay("shrink mud facials → mud → mud facials", MUD_TILES, [
  { transcript: "mud facials", level: "preview", expect: ["mud facials"] },
  { transcript: "mud", level: "preview", expect: ["mud facials"] },
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
]);

// 11. Tokenization variation (who ever laid ↔ whoever laid) must not detach a
// committed tile — the repair path stays matcher-equivalent.
{
  const tiles: readonly PuzzlePart[] = [
    part("t-whoever-laid", "Who ever laid"),
    part("t-their-eyes", "their eyes"),
    part("t-on-coraline", "on Coraline"),
  ];
  replay("who ever laid ↔ whoever laid", tiles, [
    { transcript: "who ever laid", level: "final", expect: ["Who ever laid"] },
    { transcript: "whoever laid", level: "final", expect: ["Who ever laid"] },
    {
      transcript: "whoever laid their eyes",
      level: "final",
      expect: ["Who ever laid", "their eyes"],
    },
    {
      transcript: "whoever laid their eyes on coraline",
      level: "final",
      expect: ["Who ever laid", "their eyes", "on Coraline"],
    },
  ]);
}

// 12–13. Spoken order is authoritative: caption order is "what the boss say",
// the user said "the boss say what", and the UI must keep the spoken order.
{
  const tiles: readonly PuzzlePart[] = [
    part("t-what", "what"),
    part("t-the-boss", "the boss"),
    part("t-say", "say"),
  ];
  replay("spoken order beats caption order", tiles, [
    {
      transcript: "the boss say what",
      level: "final",
      expect: ["the boss", "say", "what"],
    },
  ]);
}

// 14. A committed tile must not disappear because of a weaker interim
// hypothesis that no longer contains its evidence.
replay("committed tile survives weak interim", MUD_TILES, [
  { transcript: "mud baths", level: "final", expect: ["mud baths"] },
  { transcript: "mud", level: "preview", expect: ["mud baths"] },
  { transcript: "mud baths", level: "preview", expect: ["mud baths"] },
]);

// STT often hears "will" after "old" — sticky "well" must not detach on preview.
{
  const tiles: readonly PuzzlePart[] = [
    part("t-im", "I'm"),
    part("t-just", "just"),
    part("t-looking", "looking"),
    part("t-for", "for"),
    part("t-an", "an"),
    part("t-old", "old"),
    part("t-well", "well"),
  ];
  replay("well stays when STT rewrites to will", tiles, [
    {
      transcript: "im just looking for an old well",
      level: "preview",
      expect: ["I'm", "just", "looking", "for", "an", "old", "well"],
    },
    {
      transcript: "im just looking for an old will know it",
      level: "preview",
      expect: ["I'm", "just", "looking", "for", "an", "old", "well"],
    },
  ]);
}

console.log(
  `uiFinalSnapshot.prefixAmbiguity.validation: all passed (${passCount} scenarios)`,
);
