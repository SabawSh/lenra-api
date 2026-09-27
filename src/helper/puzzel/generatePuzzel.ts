import { PuzzlePart } from "@/types/puzzle";
import type { PartDifficulty } from "@/types/video";
import {
  buildPuzzleFromDbTokens,
  buildPuzzleFromTokens,
} from "./buildPuzzleFromTokens";
import { formatDisplayText, normalizeText } from "../speech/normalizer";
import { tokenize } from "../speech/tokenizer";
import { seededShuffle } from "./seededShuffle";

export { buildPuzzleFromDbTokens, buildPuzzleFromTokens };

/**
 * Subtitle cues wrapped in `{...}` mark optional wording (alternates, stage notes).
 * They are omitted from draggable puzzle chunks and from what the learner must say.
 */
export function stripPuzzleCaption(sentence: string): string {
  return sentence.replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Legacy fallback puzzle generator used when a part has no structured DB tokens yet.
 *
 * @deprecated Prefer `buildPuzzleFromTokens` for all newly processed parts.
 */
export function generatePuzzle(
  sentence: string,
  level: PartDifficulty = "easy",
  shuffleSeed?: string,
) {
  const base = stripPuzzleCaption(sentence);
  const displayWords = tokenize(base);

  let parts: string[] = [];

  if (level === "easy") {
    const phraseSplit = base
      .match(/[^,;\-]+/g)
      ?.map((s) => s.trim())
      .filter(Boolean);

    if (phraseSplit && phraseSplit.length >= 3) {
      parts = phraseSplit;
    } else {
      const chunkSize = Math.max(1, Math.ceil(displayWords.length / 3));
      for (let i = 0; i < displayWords.length; i += chunkSize) {
        parts.push(displayWords.slice(i, i + chunkSize).join(" "));
      }
    }
  } else if (level === "medium") {
    for (let i = 0; i < displayWords.length; i += 2) {
      parts.push(displayWords.slice(i, i + 2).join(" "));
    }
  } else {
    parts = displayWords;
  }

  const structuredParts: PuzzlePart[] = parts.map((text, i) => ({
    id: `part-${i}`,
    text: formatDisplayText(text),
    tokens: tokenize(normalizeText(text)),
  }));

  const seed = shuffleSeed ?? `${level}\0${sentence}`;
  return {
    parts: structuredParts,
    shuffled: seededShuffle(structuredParts, seed),
  };
}
