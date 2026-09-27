import { normalizeText } from "@/helper/speech/normalizer";
import { TOKEN_WEIGHT_TIER } from "@/lib/performance/difficulty/constants";
import type { TokenDifficultyInput } from "@/lib/performance/difficulty/types";

const ARTICLES = new Set(["a", "an", "the"]);
const FILLER = new Set([
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "is",
  "are",
  "am",
  "was",
  "were",
  "be",
  "been",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "that",
  "this",
  "and",
  "or",
  "but",
  "so",
  "if",
  "as",
  "not",
]);

const CONTRACTION_RE =
  /n't|'re|'ve|'ll|'d|'m\b|\b\w+'\w+/i;

function wordNorm(text: string): string {
  return normalizeText(text).split(/\s+/).filter(Boolean)[0] ?? "";
}

function isContraction(text: string): boolean {
  return CONTRACTION_RE.test(text);
}

/**
 * Deterministic per-token (or per-chunk) linguistic weight.
 * Uses surface cues today; pipeline can later pass explicit `difficulty` on tokens.
 */
export function getTokenDifficultyWeight(input: TokenDifficultyInput): number {
  const text = input.text.trim();
  if (!text) return TOKEN_WEIGHT_TIER.easy * 0.3;

  if (input.type === "punctuation" || input.visibleInPuzzle === false) {
    return TOKEN_WEIGHT_TIER.easy * 0.35;
  }

  const norm = wordNorm(text);
  const words = Math.max(1, input.tokenCount ?? text.split(/\s+/).filter(Boolean).length);
  let weight = TOKEN_WEIGHT_TIER.easy;

  if (input.locked) {
    weight *= 0.72;
  }

  if (words >= 2) {
    // Multi-word tiles (phrasal verbs, light verb phrases) carry more learning value.
    weight *= 1 + Math.min(0.55, (words - 1) * 0.28);
  }

  if (norm.length >= 9) {
    weight *= 1.22;
  } else if (norm.length >= 7) {
    weight *= 1.1;
  }

  if (isContraction(text)) {
    weight *= 1.28;
  }

  if (ARTICLES.has(norm)) {
    weight *= 0.68;
  } else if (FILLER.has(norm)) {
    weight *= 0.78;
  }

  const clip = input.clipDifficulty;
  if (clip === "hard") weight *= 1.08;
  else if (clip === "easy") weight *= 0.94;

  return Math.max(0.35, Math.min(TOKEN_WEIGHT_TIER.hard * 1.15, weight));
}
