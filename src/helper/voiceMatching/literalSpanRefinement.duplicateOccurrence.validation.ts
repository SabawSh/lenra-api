/**
 * Duplicate identical word occurrence matching — run with:
 *   npx tsx helper/voiceMatching/literalSpanRefinement.duplicateOccurrence.validation.ts
 *
 * Regression: sentence "She says she was stolen. Stolen? Well, what do you
 * think?" contains two occurrences of "stolen". The phrase tile "she was stolen"
 * owns the first occurrence at token index 4. The standalone tile "Stolen" must
 * match the second occurrence at index 5.
 *
 * evaluateTile runs without knowledge of other candidates in the same pass, so
 * both tiles grab the first occurrence. The resolver then kills the shorter one
 * via MUTUAL_EXCLUSION, even though a free second occurrence exists.
 *
 * refineAllCandidateLiteralSpans now processes candidates longest-span-first and
 * accumulates their spans as consumed for shorter candidates, so "Stolen" is
 * shifted to the free occurrence before the resolver sees it.
 */
import { createEmptySessionPlacementState } from "@/helper/puzzel/sessionPlacementState";
import { buildUiFinalSnapshot } from "@/helper/puzzel/uiFinalSnapshot";
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import type { PlacementCommitmentLevel } from "./types";
import type { PuzzlePart } from "@/types/puzzle";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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

function placedTiles(tileTexts: readonly string[], spoken: string): string[] {
  const tiles = tileTexts.map((text, index) => ({
    id: `t${index}`,
    text,
  })) as unknown as PuzzlePart[];
  return buildUiFinalSnapshot({
    sessionId: 1,
    utteranceKey: `static:${spoken}`,
    transcriptTokens: tokenize(normalizeText(spoken)),
    voicePool: tiles,
    originalParts: tiles,
    tileTextById: new Map(tiles.map((tile) => [tile.id, tile.text])),
    priorPlacement: createEmptySessionPlacementState(),
    commitmentLevel: "final",
  }).snapshot.orderedTiles.map((tile) => tile.text);
}

// ── The reported bug: "stolen" appears twice ────────────────────────────────

const TILES = ["She says", "she was stolen", "Stolen", "Well", "what do you think"];

// Static single-pass: both tiles must be placed.
{
  const actual = placedTiles(
    TILES,
    "she says she was stolen stolen well what do you think",
  );
  assert(
    actual.join(" | ") ===
      "She says | she was stolen | Stolen | Well | what do you think",
    `static full sentence: expected all tiles, got [${actual.join(" | ")}]`,
  );
}

// Incremental: the second "stolen" must attach when it arrives.
replay("incremental stolen", TILES, [
  {
    transcript: "she says she was stolen",
    level: "preview",
    expect: ["She says", "she was stolen"],
  },
  {
    transcript: "she says she was stolen",
    level: "final",
    expect: ["She says", "she was stolen"],
  },
  {
    transcript: "she says she was stolen stolen",
    level: "preview",
    expect: ["She says", "she was stolen", "Stolen"],
  },
  {
    transcript: "she says she was stolen stolen well what do you think",
    level: "final",
    expect: ["She says", "she was stolen", "Stolen", "Well", "what do you think"],
  },
]);

// ── Span identity: verify second occurrence gets the right index ────────────

{
  const tiles = TILES.map((t, i) => ({ id: `t${i}`, text: t })) as unknown as PuzzlePart[];
  const r = buildUiFinalSnapshot({
    sessionId: 1,
    utteranceKey: "span-check",
    transcriptTokens: tokenize(
      normalizeText("she says she was stolen stolen well what do you think"),
    ),
    voicePool: tiles,
    originalParts: tiles,
    tileTextById: new Map(tiles.map((tile) => [tile.id, tile.text])),
    priorPlacement: createEmptySessionPlacementState(),
    commitmentLevel: "final",
  });

  const phraseCandidate = r.matchResult.candidates.find(
    (c) => tiles.find((t) => t.id === c.tileId)?.text === "she was stolen",
  );
  const stolenCandidate = r.matchResult.candidates.find(
    (c) => tiles.find((t) => t.id === c.tileId)?.text === "Stolen",
  );

  assert(
    phraseCandidate != null && phraseCandidate.span.end === 4,
    `"she was stolen" must claim span ending at 4 (first occurrence)`,
  );
  assert(
    stolenCandidate != null && stolenCandidate.span.start === 5,
    `"Stolen" must claim span at 5 (second occurrence), got ${stolenCandidate?.span.start}`,
  );
}

// ── General duplicate-word cases ────────────────────────────────────────────

// Two identical standalone tiles for the same word.
{
  const actual = placedTiles(["go", "go"], "go go");
  assert(
    actual.join(" | ") === "go | go",
    `two "go" tiles for "go go": expected [go | go], got [${actual.join(" | ")}]`,
  );
}

// A phrase tile and a standalone tile sharing a word, in reverse order.
{
  const actual = placedTiles(
    ["bright", "the bright star"],
    "the bright star was bright",
  );
  assert(
    actual.join(" | ") === "the bright star | bright",
    `"the bright star" + "bright": expected both, got [${actual.join(" | ")}]`,
  );
}

// Word appearing three times: two in phrases, one standalone.
{
  const actual = placedTiles(
    ["I said", "said goodbye", "said"],
    "I said said goodbye said",
  );
  assert(
    actual.includes("I said") &&
      actual.includes("said goodbye") &&
      actual.includes("said"),
    `three "said" occurrences: expected all tiles, got [${actual.join(" | ")}]`,
  );
}

// No false sharing: different tiles for the same word must each get a distinct span.
{
  const tiles = ["run", "run fast"].map((t, i) => ({
    id: `t${i}`,
    text: t,
  })) as unknown as PuzzlePart[];
  const r = buildUiFinalSnapshot({
    sessionId: 1,
    utteranceKey: "distinct-span",
    transcriptTokens: tokenize(normalizeText("run run fast")),
    voicePool: tiles,
    originalParts: tiles,
    tileTextById: new Map(tiles.map((tile) => [tile.id, tile.text])),
    priorPlacement: createEmptySessionPlacementState(),
    commitmentLevel: "final",
  });
  const spans = r.matchResult.candidates.map(
    (c) => `${c.span.start}-${c.span.end}`,
  );
  assert(
    new Set(spans).size === spans.length || spans.length <= 1,
    `candidates must have distinct spans, got ${JSON.stringify(spans)}`,
  );
}

console.log(
  "literalSpanRefinement.duplicateOccurrence.validation: all passed",
);
