/**
 * Hard vs. soft lexical evidence — run with:
 *   npx tsx helper/voiceMatching/lexicalEvidenceStrength.validation.ts
 *
 * Regression: saying "Where is your house?" committed the tile `mouse`.
 *
 * `lexicalEvidenceMatchSingle` accepted any two words of 5+ characters that
 * were the same length and one substitution apart, and the evidence gate — the
 * gate that authorizes a tier-1 hard GATE_MATCH — treated that as proof the
 * word had been spoken. English minimal pairs are exactly one substitution
 * apart, so mouse/house, light/night, think/thing, horse/house and mouse/louse
 * all qualified. The tier assignment ended up anti-correlated with actual
 * pronunciation: mouse/house (phonetic 0.833) was accepted as T1 "exact
 * lexical" while coraline/caroline (0.957) was demoted to the softest tier,
 * because only spelling distance was consulted.
 *
 * The rule was self-reinforcing too: fuzzy lexical matching is meant to require
 * an independent anchor first, but for a single-token tile `hasAnchorInWindow`
 * derived that anchor from the same fuzzy match it was supposed to gate.
 *
 * Lexical evidence now carries a strength. Only `exact` (the tile token or a
 * registered lexicon form) authorizes the gate and the anchor; one-edit
 * spelling similarity stays as `typo` and is judged by the phonetic tiers.
 *
 * Guards four layers: the predicate, the evidence gate, the anchor's
 * independence, and the placed UI.
 */
import { createEmptySessionPlacementState } from "@/helper/puzzel/sessionPlacementState";
import { buildUiFinalSnapshot } from "@/helper/puzzel/uiFinalSnapshot";
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import type { PuzzlePart } from "@/types/puzzle";
import { validateEvidence } from "./evidenceValidation";
import { evaluateTile } from "./evaluateTile";
import {
  hardLexicalEvidenceMatch,
  lexicalEvidenceMatch,
  lexicalEvidenceStrength,
} from "./lexicalMatch";
import { resolveVoiceMatchingConfig } from "./voiceMatchingConfig";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const config = resolveVoiceMatchingConfig(undefined);

/** Distinct English minimal pairs that the old one-edit rule accepted as hard. */
const MINIMAL_PAIRS: readonly (readonly [string, string])[] = [
  ["mouse", "house"],
  ["house", "mouse"],
  ["light", "night"],
  ["think", "thing"],
  ["horse", "house"],
  ["mouse", "louse"],
  ["mouse", "moose"],
];

// ── Layer 1: the predicate ──────────────────────────────────────────────────

assert(
  lexicalEvidenceStrength("mouse", "mouse") === "exact",
  "an identical token is hard evidence",
);
for (const [tile, spoken] of MINIMAL_PAIRS) {
  assert(
    lexicalEvidenceStrength(tile, spoken) === "typo",
    `${tile}/${spoken} is one-edit spelling similarity, not hard evidence`,
  );
  assert(
    !hardLexicalEvidenceMatch(tile, spoken),
    `${tile}/${spoken} must never be hard lexical evidence`,
  );
}

// Typo tolerance is retained for soft consumers, not deleted.
assert(
  lexicalEvidenceMatch("mouse", "house"),
  "one-edit similarity must remain observable as soft evidence",
);
assert(
  lexicalEvidenceStrength("mouse", "mouth") === "none",
  "two edits apart is not lexical evidence at all",
);
// Guards preserved from the original rule.
assert(
  lexicalEvidenceStrength("other", "mother") === "none",
  "insert/delete pairs must not pass as substitutions",
);
assert(
  lexicalEvidenceStrength("cat", "bat") === "none",
  "short tokens stay excluded",
);

// ── Layer 2: the evidence gate authorizing GATE_MATCH ───────────────────────

assert(
  validateEvidence(["mouse"], ["mouse"]).pass,
  "the exact token must pass the evidence gate",
);
for (const [tile, spoken] of MINIMAL_PAIRS) {
  assert(
    !validateEvidence([tile], [spoken]).pass,
    `${tile}/${spoken} must not pass the evidence gate`,
  );
}

// ── Layer 3: anchor independence (no circular self-satisfaction) ────────────
//
// A multi-token tile needs an anchor before fuzzy lexical evidence is allowed.
// "mouse" is 5 characters so it qualifies as an anchor word; if the anchor were
// still derived from one-edit similarity, spoken "house" would supply it.
assert(
  !validateEvidence(["mouse", "circus"], ["house", "circus"]).pass,
  "a one-edit lookalike must not supply the anchor for the rest of the tile",
);
assert(
  validateEvidence(["mouse", "circus"], ["mouse", "circus"]).pass,
  "a genuinely spoken anchor must still pass",
);

// ── Layer 4: evaluateTile tier ─────────────────────────────────────────────

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
    ? `${result.candidate.acceptReason}:T${result.candidate.evidenceTier}`
    : `REJECTED:${result.rejected.reason}`;
}

assert(
  evaluate("mouse", ["mouse"]) === "GATE_MATCH:T1",
  `exact mouse must stay T1, got ${evaluate("mouse", ["mouse"])}`,
);
assert(
  evaluate("house", ["house"]) === "GATE_MATCH:T1",
  `exact house must stay T1, got ${evaluate("house", ["house"])}`,
);
for (const [tile, spoken] of MINIMAL_PAIRS) {
  const outcome = evaluate(tile, [spoken]);
  assert(
    !outcome.startsWith("GATE_MATCH"),
    `${tile}/${spoken} must not be a GATE_MATCH, got ${outcome}`,
  );
}

// Existing phonetic behavior is untouched: these are decided by pronunciation,
// not spelling, and keep whatever the phonetic tiers already concluded.
assert(
  evaluate("coraline", ["caroline"]) === "PHRASE_SIMILARITY:T4",
  `coraline/caroline must keep its fuzzy acceptance, got ${evaluate("coraline", ["caroline"])}`,
);
assert(
  evaluate("girl", ["girls"]) === "PHRASE_SIMILARITY:T4",
  `girl/girls must keep its existing behavior, got ${evaluate("girl", ["girls"])}`,
);
assert(
  evaluate("mouse", ["most"]) === "PHRASE_SIMILARITY:T4",
  `mouse/most keeps its existing soft acceptance and must not be promoted, got ${evaluate("mouse", ["most"])}`,
);
assert(
  evaluate("mouse", ["mouth"]).startsWith("REJECTED"),
  `mouse/mouth stays rejected, got ${evaluate("mouse", ["mouth"])}`,
);

// ── Layer 5: real UI placement ─────────────────────────────────────────────

function placedTiles(tileTexts: readonly string[], spoken: string): string[] {
  const tiles = tileTexts.map((text, index) => ({
    id: `t${index}`,
    text,
  })) as unknown as PuzzlePart[];

  const result = buildUiFinalSnapshot({
    sessionId: 1,
    utteranceKey: `${tileTexts.join(",")}:${spoken}`,
    transcriptTokens: tokenize(normalizeText(spoken)),
    voicePool: tiles,
    originalParts: tiles,
    tileTextById: new Map(tiles.map((tile) => [tile.id, tile.text])),
    priorPlacement: createEmptySessionPlacementState(),
    commitmentLevel: "final",
  });
  return result.snapshot.orderedTiles.map((tile) => tile.text);
}

function expectPlacement(
  tileTexts: readonly string[],
  spoken: string,
  expected: readonly string[],
): void {
  const actual = placedTiles(tileTexts, spoken);
  assert(
    actual.length === expected.length &&
      actual.every((text, index) => text === expected[index]),
    `tiles [${tileTexts.join(" | ")}] + "${spoken}": expected [${expected.join(
      " | ",
    )}] but got [${actual.join(" | ")}]`,
  );
}

// The confirmed reproduction, through the production placement pipeline.
expectPlacement(["mouse"], "Where is your house?", []);
expectPlacement(["mouse"], "Where is your mouse?", ["mouse"]);
expectPlacement(["house"], "Where is your house?", ["house"]);

// The real word still wins when both tiles are on the board, in spoken order.
expectPlacement(["mouse", "house"], "Where is your house?", ["house"]);
expectPlacement(["mouse", "house"], "Where is your mouse?", ["mouse"]);
expectPlacement(["mouse", "house"], "the mouse and the house", [
  "mouse",
  "house",
]);

console.log("lexicalEvidenceStrength.validation: all passed");
