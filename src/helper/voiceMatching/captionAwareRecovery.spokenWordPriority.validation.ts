/**
 * Spoken words outrank caption look-alikes — run with:
 *   npx tsx helper/voiceMatching/captionAwareRecovery.spokenWordPriority.validation.ts
 *
 * Regression: with caption "Famous jumping mouse circus …", recovery rewrote the
 * correctly-heard token "famous" into the similar caption entity "mouse"
 * (phonetic score 0.906), and symmetrically "mouse" → "Famous". The matcher then
 * saw "mouse jumping", gave `mouse` a tier-1 GATE_MATCH on token 0, and
 * `Famous jumping` could never be proposed.
 *
 * Recovery repairs mishearings only. A span the caption already contains
 * verbatim was not misheard and must never be rewritten — otherwise the caption
 * overrules the speaker and even reorders the sentence
 * ("famous jumping mouse" → "mouse jumping Famous").
 *
 * Drives the real voice-session path (normalize → recovery → matcher → resolver
 * → placement → UI), because the defect lived upstream of the matcher.
 */
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import {
  createInitialVoiceSessionState,
  handleSpeechHypothesis,
  handleSpeechTranscript,
  type VoiceSessionCoreState,
  type VoiceSessionPuzzle,
} from "@/helper/speech/voiceSession";
import type { PuzzlePart } from "@/types/puzzle";
import {
  buildCaptionVocabulary,
  recoverCaptionVocabulary,
} from "./captionAwareRecovery";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const CAPTION = "Famous jumping mouse circus is not ready little girl";

const TILES = [
  { id: "t-mouse", text: "mouse" },
  { id: "t-famous-jumping", text: "Famous jumping" },
  { id: "t-not-ready", text: "not ready" },
  { id: "t-girl", text: "girl" },
  { id: "t-little", text: "little" },
  { id: "t-circus-lower", text: "circus" },
  { id: "t-circus-upper", text: "Circus" },
] as unknown as PuzzlePart[];

const captionVocabulary = buildCaptionVocabulary({
  caption: CAPTION,
  tileTexts: TILES.map((tile) => tile.text),
});
const captionTokens = tokenize(normalizeText(CAPTION));

const puzzle: VoiceSessionPuzzle = {
  voicePool: TILES,
  originalParts: TILES,
  captionTokens,
  captionVocabulary,
};

function recover(transcript: string): string {
  return recoverCaptionVocabulary({
    transcript,
    captionVocabulary,
    captionTokens,
  }).recoveredTranscript;
}

function normJoin(text: string): string {
  return tokenize(normalizeText(text)).join(" ");
}

// ── Recovery layer: the speaker's own words survive ─────────────────────────

assert(
  normJoin(recover("famous")) === "famous",
  `"famous" must not be rewritten, got "${recover("famous")}"`,
);
assert(
  normJoin(recover("mouse")) === "mouse",
  `"mouse" must not be rewritten, got "${recover("mouse")}"`,
);
assert(
  normJoin(recover("famous jumping")) === "famous jumping",
  `"famous jumping" must survive, got "${recover("famous jumping")}"`,
);
// The swap that reordered the sentence.
assert(
  normJoin(recover("famous jumping mouse")) === "famous jumping mouse",
  `spoken order must survive, got "${recover("famous jumping mouse")}"`,
);
// Genuine mishearings are still repaired — "fame" is not a caption word.
assert(
  normJoin(recover("fame")) === "famous",
  `genuine mishearing must still recover, got "${recover("fame")}"`,
);

// ── End-to-end placement over the real event path ───────────────────────────

type Event =
  | { kind: "interim"; text: string }
  | { kind: "engineFinal"; text: string }
  | { kind: "transcript"; text: string };

function replay(
  name: string,
  events: readonly Event[],
  /** Per-event puzzle override (caption vocabulary loads asynchronously). */
  puzzleForEvent?: (index: number) => VoiceSessionPuzzle,
): { ui: string[]; state: VoiceSessionCoreState } {
  let state = createInitialVoiceSessionState(1);
  let nowMs = 0;
  events.forEach((event, index) => {
    nowMs += 500;
    const eventPuzzle = puzzleForEvent?.(index) ?? puzzle;
    const step =
      event.kind === "transcript"
        ? handleSpeechTranscript(state, eventPuzzle, {
            raw: event.text,
            nowMs,
          })
        : handleSpeechHypothesis(state, eventPuzzle, {
            text: event.text,
            hypothesisFinal: event.kind === "engineFinal",
          });
    state = step.state;
  });
  const ui = (state.snapshot?.orderedTiles ?? []).map((tile) => tile.text);
  return { ui, state };
}

function expectUi(
  name: string,
  events: readonly Event[],
  expected: readonly string[],
  puzzleForEvent?: (index: number) => VoiceSessionPuzzle,
): VoiceSessionCoreState {
  const { ui, state } = replay(name, events, puzzleForEvent);
  assert(
    ui.length === expected.length &&
      ui.every((text, index) => text === expected[index]),
    `${name}: expected [${expected.join(" | ")}] but got [${ui.join(" | ")}]`,
  );
  return state;
}

/** Full Chrome shape for one spoken phrase: interims, engine final, onTranscript. */
function spoken(phrase: string): Event[] {
  const words = phrase.split(" ");
  return [
    ...words.map((_, index) => ({
      kind: "interim" as const,
      text: words.slice(0, index + 1).join(" "),
    })),
    { kind: "engineFinal", text: phrase },
    { kind: "transcript", text: phrase },
  ];
}

// 1. The reported case.
expectUi("famous jumping", spoken("famous jumping"), ["Famous jumping"]);

// 2. "famous" alone — no new rule is asserted about which tile wins; the
// invariant under test is that the spoken token reaches the matcher intact.
{
  const { state } = replay("famous alone", spoken("famous"));
  assert(
    normJoin(recover(state.sessionTranscript)) === "famous",
    `"famous" must reach the matcher unrewritten, got "${recover(state.sessionTranscript)}"`,
  );
}

// 3. Both tiles legitimately spoken — neither collapses, spoken order kept.
expectUi("mouse famous jumping", spoken("mouse famous jumping"), [
  "mouse",
  "Famous jumping",
]);

// 4. Plain single tile.
expectUi("mouse", spoken("mouse"), ["mouse"]);

// 8. A weaker later hypothesis must not remove an accepted tile.
expectUi(
  "weak hypothesis after famous jumping",
  [...spoken("famous jumping"), { kind: "interim", text: "famous" }],
  ["Famous jumping"],
);

// 9. A similar-looking unrelated tile must not steal an accepted placement:
// `mouse` may not take over the span already owned by `Famous jumping`.
{
  const state = expectUi(
    "similar tile must not steal placement",
    [
      ...spoken("famous jumping"),
      { kind: "interim", text: "famous jumping" },
      { kind: "transcript", text: "famous jumping" },
    ],
    ["Famous jumping"],
  );
  const placed = state.placement.placedTiles;
  assert(
    placed.has("t-famous-jumping"),
    "Famous jumping must remain committed",
  );
  assert(
    !placed.has("t-mouse"),
    "mouse must not own a placement after Famous jumping is accepted",
  );
  const entry = placed.get("t-famous-jumping")!;
  assert(
    entry.matchedSpan.start === 0 && entry.matchedSpan.end === 1,
    `Famous jumping must own span 0-1, got ${entry.matchedSpan.start}-${entry.matchedSpan.end}`,
  );
}

// 10. The exact reported lifecycle. The caption vocabulary is built from an
// async-loaded caption, so the first hypothesis can run with an empty
// vocabulary: `Famous jumping` commits, then recovery becomes active on the next
// pass. Before the fix this produced
//   Famous jumping[0,1]
//   → Famous jumping[-1,-1] | mouse[0,0]   (detached by preparePrior)
//   → mouse[0,0]                            (purged by purgeDetachedPlacements)
// A committed tile must not be unseated by a caption look-alike.
{
  const emptyVocabPuzzle: VoiceSessionPuzzle = {
    ...puzzle,
    captionVocabulary: [],
  };
  expectUi(
    "late caption vocabulary must not unseat a committed tile",
    [
      { kind: "interim", text: "famous jumping" },
      { kind: "interim", text: "famous jumpin" },
      { kind: "engineFinal", text: "famous jumping" },
      { kind: "transcript", text: "famous jumping" },
    ],
    ["Famous jumping"],
    (index) => (index === 0 ? emptyVocabPuzzle : puzzle),
  );
}

console.log(
  "captionAwareRecovery.spokenWordPriority.validation: all passed (13 assertions)",
);
