/**
 * Contained single-token fuzzy match guard — run with:
 *   npx tsx helper/voiceMatching/containedFuzzyMatch.validation.ts
 *
 * Regression: spoken "famous" committed the tile `mouse`, because
 * [m, ow, s] is contained in [f, a, m, ow, s] and the weighted phonetic
 * distance scored 0.906 against a 0.9 threshold (only cheap insertions, zero
 * substitutions). `Famous jumping` could not compete yet — a two-token tile is
 * correctly INSUFFICIENT_EVIDENCE on a one-token hypothesis — so the wrong tile
 * was the only one on screen until "jumping" arrived and displaced it.
 *
 * Guards three layers: the predicate, evaluateTile acceptance, and the placed UI.
 * Also pins the legitimate fuzzy matches that must survive.
 */
import { createEmptySessionPlacementState } from "@/helper/puzzel/sessionPlacementState";
import { buildUiFinalSnapshot } from "@/helper/puzzel/uiFinalSnapshot";
import type { PuzzlePart } from "@/types/puzzle";
import {
  isContainedSingleTokenFuzzyMatch,
  isPhonemeSubsequence,
} from "./containedFuzzyMatch";
import { evaluateTile } from "./evaluateTile";
import { scorePhraseSimilarity } from "./phraseSimilarityEngine";
import { tokenizeTileText } from "./textUtils";
import type { PlacementCommitmentLevel } from "./types";
import { resolveVoiceMatchingConfig } from "./voiceMatchingConfig";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const config = resolveVoiceMatchingConfig(undefined);

// ── Layer 1: the predicate ──────────────────────────────────────────────────

assert(
  isPhonemeSubsequence(["m", "ow", "s"], ["f", "a", "m", "ow", "s"]),
  "mouse phonemes are contained in famous phonemes",
);
assert(
  !isPhonemeSubsequence(["m", "ow", "s"], ["m", "ow", "th"]),
  "mouth is a substitution, not containment",
);

function contained(tileText: string, spoken: string): boolean {
  const scored = scorePhraseSimilarity(tileText, spoken);
  return isContainedSingleTokenFuzzyMatch({
    tileTokenCount: tokenizeTileText(tileText).length,
    expectedPhonemes: scored.diagnostics.expectedPhonemes,
    observedPhonemes: scored.diagnostics.observedPhonemes,
  });
}

assert(contained("mouse", "famous"), "mouse/famous must be flagged as contained");
assert(
  contained("ready", "already"),
  "ready/already must be flagged as contained",
);
// Legitimate matches must NOT be flagged.
assert(!contained("girl", "girls"), "girl/girls is inflection, not containment");
assert(
  !contained("coraline", "caroline"),
  "coraline/caroline is a same-length approximation",
);
assert(!contained("mouse", "mouse"), "identical tokens are never contained");
// Multi-token tiles are out of scope for this guard.
assert(
  !contained("Famous jumping", "famous jumping extra words"),
  "multi-token tiles must never be judged by this guard",
);

// ── Layer 2: evaluateTile acceptance ────────────────────────────────────────

function evaluate(tileText: string, spokenTokens: readonly string[]): string {
  const result = evaluateTile(
    "tile-under-test",
    tileText,
    { tokens: [...spokenTokens], startOffset: 0 },
    [],
    config,
    null,
    undefined,
  );
  return "candidate" in result
    ? result.candidate.acceptReason
    : `REJECTED:${result.rejected.reason}`;
}

assert(
  evaluate("mouse", ["famous"]).startsWith("REJECTED"),
  `mouse must not be a candidate for spoken "famous", got ${evaluate("mouse", ["famous"])}`,
);
assert(
  evaluate("ready", ["already"]).startsWith("REJECTED"),
  `ready must not be a candidate for spoken "already", got ${evaluate("ready", ["already"])}`,
);
// Exact and legitimate fuzzy paths unchanged.
assert(
  evaluate("mouse", ["mouse"]) === "GATE_MATCH",
  "exact mouse must still GATE_MATCH",
);
assert(
  evaluate("girl", ["girls"]) === "PHRASE_SIMILARITY",
  `girl/girls must keep its existing fuzzy acceptance, got ${evaluate("girl", ["girls"])}`,
);
assert(
  evaluate("coraline", ["caroline"]) === "PHRASE_SIMILARITY",
  `coraline/caroline must keep its existing fuzzy acceptance, got ${evaluate("coraline", ["caroline"])}`,
);

// ── Layer 3: end-to-end placement ───────────────────────────────────────────

const MOUSE_TILES = [
  { id: "t-mouse", text: "mouse" },
  { id: "t-famous-jumping", text: "Famous jumping" },
  { id: "t-not-ready", text: "not ready" },
  { id: "t-girl", text: "girl" },
  { id: "t-little", text: "little" },
  { id: "t-circus-lower", text: "circus" },
  { id: "t-circus-upper", text: "Circus" },
] as unknown as PuzzlePart[];

const OAK_TILES = [
  { id: "t-oak", text: "oak" },
  { id: "t-poison-oak", text: "poison oak" },
] as unknown as PuzzlePart[];

type Step = {
  transcript: string;
  level: PlacementCommitmentLevel;
  expect: readonly string[];
};

function replay(
  name: string,
  tiles: readonly PuzzlePart[],
  steps: readonly Step[],
): void {
  const tileTextById = new Map(tiles.map((tile) => [tile.id, tile.text]));
  let placement = createEmptySessionPlacementState();

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

// 1. The main bug: no tile at all on "famous", then only the real tile.
// There must never be an intermediate committed `mouse`.
replay("famous → famous jumping", MOUSE_TILES, [
  { transcript: "famous", level: "preview", expect: [] },
  { transcript: "famous", level: "final", expect: [] },
  { transcript: "famous jumping", level: "preview", expect: ["Famous jumping"] },
  { transcript: "famous jumping", level: "final", expect: ["Famous jumping"] },
]);

// 2. Exact single-token behavior is untouched.
replay("mouse", MOUSE_TILES, [
  { transcript: "mouse", level: "final", expect: ["mouse"] },
]);

// 6. The real `mouse` occurrence is still selectable when actually spoken.
replay("mouse famous jumping", MOUSE_TILES, [
  {
    transcript: "mouse famous jumping",
    level: "final",
    expect: ["mouse", "Famous jumping"],
  },
]);

// 5. `oak` must not be taken from an embedded pronunciation, but a literally
// spoken "oak" token still matches and the longer phrase still wins its span.
replay("poison oak", OAK_TILES, [
  { transcript: "poison", level: "final", expect: [] },
  { transcript: "poison oak", level: "final", expect: ["poison oak"] },
]);
replay("oak alone", OAK_TILES, [
  { transcript: "oak", level: "final", expect: ["oak"] },
]);

// 8. A weaker later hypothesis must not remove the accepted tile (prefix-hold
// keeps it attached; the guard must not interfere with that).
replay("weak hypothesis after famous jumping", MOUSE_TILES, [
  { transcript: "famous jumping", level: "preview", expect: ["Famous jumping"] },
  { transcript: "famous", level: "preview", expect: ["Famous jumping"] },
  { transcript: "famous jumping", level: "final", expect: ["Famous jumping"] },
]);

// 7. The provisional-prefix mechanism is unaffected (full matrix lives in
// uiFinalSnapshot.prefixAmbiguity.validation.ts).
const MUD_TILES = [
  { id: "t-mud", text: "mud" },
  { id: "t-mud-facials", text: "mud facials" },
] as unknown as PuzzlePart[];

replay("mud", MUD_TILES, [
  { transcript: "mud", level: "final", expect: ["mud"] },
]);
replay("mud facials", MUD_TILES, [
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
]);
replay("mud then mud facials", MUD_TILES, [
  { transcript: "mud", level: "final", expect: ["mud"] },
  { transcript: "mud facials", level: "final", expect: ["mud facials"] },
]);
replay("mud mud facials", MUD_TILES, [
  {
    transcript: "mud mud facials",
    level: "final",
    expect: ["mud", "mud facials"],
  },
]);

console.log("containedFuzzyMatch.validation: all passed");
