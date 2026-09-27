/**
 * Web Speech hypothesis order — run with:
 *   npx tsx helper/speech/mergeTranscriptWithOverlap.hypothesisOrder.validation.ts
 *
 * Transcript reconstruction must preserve engine results-index order.
 * Never bucket finals before interims (that invents a new word order).
 * Never use caption to reorder.
 */
import { buildWebSpeechHypothesisFromResults } from "./mergeTranscriptWithOverlap";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

type FakeResult = {
  isFinal: boolean;
  0: { transcript: string };
};

function hypothesis(results: FakeResult[]): string {
  return buildWebSpeechHypothesisFromResults(results).hypothesis;
}

{
  // Speech order preserved when Chrome emits early word first, then phrase.
  const out = hypothesis([
    { isFinal: true, 0: { transcript: "what" } },
    { isFinal: false, 0: { transcript: "the boss say" } },
  ]);
  assert(
    out === "what the boss say",
    `expected "what the boss say", got ${JSON.stringify(out)}`,
  );
}

{
  // Engine emission order preserved even when final sits before interim.
  // (Previously finals-then-interim still produced this string, but via the
  // wrong mechanism; index-order merge must keep the same temporal sequence.)
  const out = hypothesis([
    { isFinal: true, 0: { transcript: "the boss say" } },
    { isFinal: false, 0: { transcript: "what" } },
  ]);
  assert(
    out === "the boss say what",
    `expected engine order "the boss say what", got ${JSON.stringify(out)}`,
  );
}

{
  // Correct speech order must survive when Chrome lists the opening word first.
  const out = hypothesis([
    { isFinal: false, 0: { transcript: "what" } },
    { isFinal: false, 0: { transcript: "the boss say" } },
  ]);
  assert(
    out === "what the boss say",
    `interim-only speech order broken: ${JSON.stringify(out)}`,
  );
}

{
  // Single result — pass through unchanged (any spoken order).
  for (const spoken of [
    "what the boss say",
    "the boss say what",
    "boss say the what",
    "what boss the say",
  ]) {
    const out = hypothesis([{ isFinal: false, 0: { transcript: spoken } }]);
    assert(out === spoken, `pass-through failed for ${JSON.stringify(spoken)}`);
  }
}

{
  // Must not invent finals-before-interims order when early word is index 0.
  // Regression: old code put all finals first, so
  //   [interim "what the", final "boss", interim "say"]
  // became "boss what the say" instead of "what the boss say".
  const out = hypothesis([
    { isFinal: false, 0: { transcript: "what the" } },
    { isFinal: true, 0: { transcript: "boss" } },
    { isFinal: false, 0: { transcript: "say" } },
  ]);
  assert(
    out === "what the boss say",
    `finals-bucket regression: expected "what the boss say", got ${JSON.stringify(out)}`,
  );
}

process.stdout.write(
  "mergeTranscriptWithOverlap.hypothesisOrder.validation: all passed\n",
);
