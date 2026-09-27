/**
 * CaptionAwareRecovery validation — run with:
 *   npx tsx helper/voiceMatching/captionAwareRecovery.validation.ts
 */
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import {
  buildCaptionVocabulary,
  isEntityBoundaryViolation,
  isOrdinaryPhraseCollapse,
  recoverCaptionVocabulary,
} from "./captionAwareRecovery";

const CAPTION =
  "I'm Wybie. Wybie Lovat. Wybie? Short for Wyborne. My name like Caroline.";

const TILES = [
  "Wybie",
  "Lovat",
  "Wyborne",
  "Caroline",
  "name like Caroline",
  "Short for",
  "I'm",
  "to people",
  "the house",
  "I heard",
  "an ordinary name",
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function recover(transcript: string) {
  const captionVocabulary = buildCaptionVocabulary({
    caption: CAPTION,
    tileTexts: TILES,
  });
  return recoverCaptionVocabulary({
    transcript,
    captionVocabulary,
    captionTokens: tokenize(normalizeText(CAPTION)),
  });
}

function norm(text: string): string {
  return tokenize(normalizeText(text)).join(" ");
}

function main(): void {
  const vocab = buildCaptionVocabulary({ caption: CAPTION, tileTexts: TILES });
  const norms = new Set(vocab.map((entry) => entry.normalized));
  assert(norms.has("wybie"), "vocab should include Wybie");
  assert(norms.has("caroline"), "vocab should include Caroline");
  assert(norms.has("wyborne"), "vocab should include Wyborne");
  assert(!norms.has("people"), "ordinary words must not be targets");
  assert(!norms.has("name"), "ordinary word name must not be a target");

  assert(
    isOrdinaryPhraseCollapse(["to", "people"], ["people"]),
    "to people → people is an ordinary collapse",
  );
  assert(
    isEntityBoundaryViolation(
      ["caroline", "named"],
      {
        original: "Caroline",
        normalized: "caroline",
        tokens: ["caroline"],
        reason: "capitalized",
      },
      0.9,
      (tokens) => (phraseKey(tokens) === "caroline" ? 1 : 0),
    ),
    "caroline named violates entity boundary",
  );

  // Case 1 — already correct entity form (normalized): unchanged
  {
    const result = recover("caroline");
    assert(
      norm(result.recoveredTranscript) === "caroline",
      `case1: expected caroline, got "${result.recoveredTranscript}"`,
    );
  }

  // Case 2 — misspelling of entity only
  {
    const result = recover("caraline");
    assert(
      norm(result.recoveredTranscript) === "caroline",
      `case2: caraline → caroline, got "${result.recoveredTranscript}"`,
    );
    assert(result.replacements.length === 1, "case2: one replacement");
  }

  // Case 3
  {
    const result = recover("why be");
    assert(
      norm(result.recoveredTranscript) === "wybie",
      `case3: why be → wybie, got "${result.recoveredTranscript}"`,
    );
  }

  // Case 4
  {
    const result = recover("why born");
    assert(
      norm(result.recoveredTranscript) === "wyborne",
      `case4: why born → wyborne, got "${result.recoveredTranscript}"`,
    );
  }

  // Case 5 — must NOT swallow "named"
  {
    const result = recover("caroline named");
    assert(
      norm(result.recoveredTranscript) === "caroline named",
      `case5: must stay unchanged, got "${result.recoveredTranscript}"`,
    );
    assert(result.replacements.length === 0, "case5: no replacements");
  }

  // Case 6 — only the entity token is repaired; grammar stays
  {
    const result = recover("name like caraline");
    assert(
      norm(result.recoveredTranscript) === "name like caroline",
      `case6: only caroline repaired, got "${result.recoveredTranscript}"`,
    );
    assert(
      result.replacements.length === 1 &&
        norm(result.replacements[0]!.from) === "caraline",
      "case6: replacement must be the entity span only",
    );
  }

  // Case 6b — already-correct entity in context: structure unchanged
  {
    const result = recover("name like caroline");
    assert(
      norm(result.recoveredTranscript) === "name like caroline",
      `case6b: must not collapse phrase, got "${result.recoveredTranscript}"`,
    );
  }

  // Case 7
  {
    const result = recover("an ordinary name");
    assert(
      norm(result.recoveredTranscript) === "an ordinary name",
      `case7: must stay unchanged, got "${result.recoveredTranscript}"`,
    );
  }

  // Extra BAD examples from the design note
  for (const spoken of [
    "the wybie",
    "for wyborne",
    "to people",
    "i heard",
    "the house",
  ] as const) {
    const result = recover(spoken);
    assert(
      norm(result.recoveredTranscript) === norm(spoken),
      `must not rewrite "${spoken}", got "${result.recoveredTranscript}"`,
    );
  }

  {
    const result = recover("love it");
    assert(
      norm(result.recoveredTranscript) === "lovat",
      `love it → lovat, got "${result.recoveredTranscript}"`,
    );
  }

  // Must not expand "almost" into "I almost" when "I" is already present.
  {
    const caption = "I almost died.";
    const tiles = ["I", "I almost", "died"];
    const captionVocabulary = buildCaptionVocabulary({
      caption,
      tileTexts: tiles,
    });
    assert(
      !captionVocabulary.some((entry) => entry.normalized === "i almost"),
      "hybrid phrase I almost must not be a recovery target",
    );
    const result = recoverCaptionVocabulary({
      transcript: "i almost",
      captionVocabulary,
      captionTokens: tokenize(normalizeText(caption)),
    });
    assert(
      norm(result.recoveredTranscript) === "i almost",
      `must not duplicate I, got "${result.recoveredTranscript}"`,
    );
  }

  // Split tiles "mangy" + "thing" — ASR often says "monkey thing".
  {
    const caption = "You scared me to death, you mangy thing.";
    const tiles = [
      "You",
      "scared",
      "me",
      "to",
      "death,",
      "you",
      "mangy",
      "thing",
    ];
    const captionVocabulary = buildCaptionVocabulary({
      caption,
      tileTexts: tiles,
    });
    assert(
      captionVocabulary.some((entry) => entry.normalized === "mangy thing"),
      "split tiles should register mangy thing phrase",
    );
    const result = recoverCaptionVocabulary({
      transcript: "you scared me to death you monkey thing",
      captionVocabulary,
      captionTokens: tokenize(normalizeText(caption)),
    });
    assert(
      norm(result.recoveredTranscript).includes("mangy thing"),
      `monkey thing should recover to mangy thing, got "${result.recoveredTranscript}"`,
    );
  }

  process.stdout.write("captionAwareRecovery.validation: OK\n");
}

function phraseKey(tokens: readonly string[]): string {
  return tokens.join(" ");
}

main();
