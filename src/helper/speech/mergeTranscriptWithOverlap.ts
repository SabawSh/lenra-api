import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";

/** Normalized tokens for structural comparison ("I'm" === "im"). */
function tokensForCompare(text: string): string[] {
  return tokenize(normalizeText(text));
}

/** Raw word tokens for merge output (preserves spoken casing). */
function tokenizeWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function tokensToText(tokens: readonly string[]): string {
  return tokens.join(" ");
}

function isTokenPrefix(
  prefix: readonly string[],
  full: readonly string[],
): boolean {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== full[i]) return false;
  }
  return true;
}

function isTokenSuffix(
  suffix: readonly string[],
  full: readonly string[],
): boolean {
  if (suffix.length > full.length) return false;
  const offset = full.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (suffix[i] !== full[offset + i]) return false;
  }
  return true;
}

function longestSuffixPrefixOverlap(
  leftTokens: readonly string[],
  rightTokens: readonly string[],
): number {
  const maxOverlap = Math.min(leftTokens.length, rightTokens.length);
  for (let k = maxOverlap; k > 0; k--) {
    let matches = true;
    for (let i = 0; i < k; i++) {
      if (leftTokens[leftTokens.length - k + i] !== rightTokens[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return k;
  }
  return 0;
}

/**
 * Caption alignment can prefer concatenation over overlap-removal whenever the
 * caption lists a duplicate at the boundary — even when the incoming fragment
 * is a forward continuation ("you" + "you scared" → invented "you you scared").
 * Only preserve the extra copy when the caption requires it AND the spoken
 * continuation after the overlap still matches the caption (or the right side
 * is a pure repeat with no trailing words).
 */
function isBoundaryDuplicateJustified(
  leftTokens: readonly string[],
  rightTokens: readonly string[],
  overlapLen: number,
  captionTokens: readonly string[],
): boolean {
  if (overlapLen <= 0) return false;

  const left = tokensForCaptionScore(leftTokens);
  const right = tokensForCaptionScore(rightTokens);
  const cap = tokensForCaptionScore(captionTokens);
  if (left.length === 0 || right.length === 0 || cap.length === 0) return false;

  const overlap = tokensForCaptionScore(right.slice(0, overlapLen));
  if (overlap.length !== overlapLen) return false;

  let capIdx = 0;
  for (const token of left) {
    if (capIdx < cap.length && token === cap[capIdx]) capIdx += 1;
  }

  let dupCapIdx = capIdx;
  for (const token of overlap) {
    if (dupCapIdx >= cap.length || token !== cap[dupCapIdx]) return false;
    dupCapIdx += 1;
  }

  const spokenAfter = right.slice(overlapLen);
  const captionAfter = cap.slice(dupCapIdx);

  if (spokenAfter.length === 0) return true;
  if (captionAfter.length === 0) return false;

  return spokenAfter[0] === captionAfter[0];
}

/** Same token pipeline as speech/caption so "I'm" and "im" compare equal. */
function tokensForCaptionScore(tokens: readonly string[]): string[] {
  if (tokens.length === 0) return [];
  return tokenize(normalizeText(tokens.join(" ")));
}

/**
 * Deterministic O(n) caption alignment score.
 * Walks caption left-to-right, consuming candidate tokens only on exact match.
 * Captures ordered coverage and duplicate-token preservation (each caption
 * occurrence must be supplied by the candidate in order).
 */
export function captionAlignmentScore(
  candidateTokens: readonly string[],
  captionTokens: readonly string[],
): number {
  if (captionTokens.length === 0) return 0;

  const cand = tokensForCaptionScore(candidateTokens);
  const cap = tokensForCaptionScore(captionTokens);

  let candIdx = 0;
  let covered = 0;
  for (let i = 0; i < cap.length; i++) {
    if (candIdx < cand.length && cand[candIdx] === cap[i]) {
      covered += 1;
      candIdx += 1;
    }
  }

  return covered;
}

export type MergeTranscriptOptions = {
  /**
   * Canonical puzzle caption tokens (already normalized/tokenized).
   * When provided and suffix/prefix overlap is detected, choose between
   * overlap-removed merge and simple concatenation by caption alignment.
   */
  captionTokens?: readonly string[];
};

/**
 * Merge two transcript fragments using normalized token prefix/suffix overlap.
 * Safe for Web Speech final+interim pairs, cross-arm session stitching, and
 * Chrome re-emits of prior finals after pauses.
 *
 * Extension/replay cases always collapse to A + tail — never A + A + tail.
 * Caption-aware concatenation is only considered for partial boundary overlaps
 * where duplicate words may be required by the caption.
 */
export function mergeTranscriptWithOverlap(
  a: string,
  b: string,
  options?: MergeTranscriptOptions,
): string {
  const left = a.trim();
  const right = b.trim();

  if (!left) return right;
  if (!right) return left;

  const captionTokens = options?.captionTokens;
  const hasCaption = !!captionTokens && captionTokens.length > 0;

  const leftTokens = tokenizeWords(left);
  const rightTokens = tokenizeWords(right);
  const leftCompare = tokensForCompare(left);
  const rightCompare = tokensForCompare(right);

  if (leftTokens.length === 0) return right;
  if (rightTokens.length === 0) return left;

  const chooseByCaption = (
    overlapRemoved: string,
    concatenation: string,
    boundary?: {
      leftTokens: readonly string[];
      rightTokens: readonly string[];
      overlapLen: number;
    },
  ): string => {
    if (!hasCaption) return overlapRemoved;
    const tokensA = tokensForCompare(overlapRemoved);
    const tokensB = tokensForCompare(concatenation);
    const scoreA = captionAlignmentScore(tokensA, captionTokens!);
    const scoreB = captionAlignmentScore(tokensB, captionTokens!);
    if (scoreB <= scoreA) return overlapRemoved;
    if (
      boundary &&
      !isBoundaryDuplicateJustified(
        boundary.leftTokens,
        boundary.rightTokens,
        boundary.overlapLen,
        captionTokens!,
      )
    ) {
      return overlapRemoved;
    }
    return concatenation;
  };

  // Identical replay — caption may still require a boundary duplicate.
  if (
    leftCompare.length === rightCompare.length &&
    leftCompare.every((token, i) => token === rightCompare[i])
  ) {
    if (!hasCaption) return left;
    return chooseByCaption(left, `${left} ${right}`, {
      leftTokens,
      rightTokens,
      overlapLen: leftCompare.length,
    });
  }

  // Incoming extends session (normal streaming or replay+tail). Never duplicate.
  if (isTokenPrefix(leftCompare, rightCompare)) {
    return right;
  }

  // Incoming is shorter than session — keep session unless caption needs another
  // boundary copy (e.g. "no no" + "no" → "no no no").
  if (isTokenPrefix(rightCompare, leftCompare)) {
    if (!hasCaption) return left;
    return chooseByCaption(left, `${left} ${right}`, {
      leftTokens,
      rightTokens,
      overlapLen: rightCompare.length,
    });
  }

  // Full replay already present at the end of session.
  if (isTokenSuffix(rightCompare, leftCompare)) {
    return left;
  }

  // Replay from an earlier point with new leading context (session is a tail).
  if (isTokenSuffix(leftCompare, rightCompare)) {
    return right;
  }

  const overlapLen = longestSuffixPrefixOverlap(leftCompare, rightCompare);

  // Entire incoming hypothesis replays the session tail — no new words.
  if (overlapLen === rightCompare.length) {
    return left;
  }

  const withOverlapRemoved = tokensToText([
    ...leftTokens,
    ...rightTokens.slice(overlapLen),
  ]);
  const withConcatenation = tokensToText([...leftTokens, ...rightTokens]);

  if (overlapLen === 0) {
    if (!hasCaption) return withOverlapRemoved;
    const scoreLeft = captionAlignmentScore(leftCompare, captionTokens!);
    const scoreRight = captionAlignmentScore(rightCompare, captionTokens!);
    const scoreConcat = captionAlignmentScore(
      tokensForCompare(withOverlapRemoved),
      captionTokens!,
    );
    if (scoreRight > scoreLeft && scoreRight > scoreConcat) {
      return right;
    }
    return withOverlapRemoved;
  }

  return chooseByCaption(withOverlapRemoved, withConcatenation, {
    leftTokens,
    rightTokens,
    overlapLen,
  });
}

export type WebSpeechHypothesisParts = {
  hypothesis: string;
  finalsOnly: string;
  lastFinal: boolean;
};

/**
 * Build one continuous hypothesis from a Web Speech `results` list.
 *
 * Preserves engine temporal order: results are merged strictly by ascending
 * index (the order Chrome emitted them). Never bucket all finals before all
 * interims — that reconstructs a different word order than the learner spoke.
 *
 * Caption / grammar must not influence this rebuild. Overlap merge only
 * collapses duplicate replays of the same span, not sentence order.
 */
export function buildWebSpeechHypothesisFromResults(
  results: SpeechRecognitionResultList | readonly SpeechRecognitionResult[],
): WebSpeechHypothesisParts {
  const len = results?.length ?? 0;
  let hypothesis = "";
  let finalsText = "";

  for (let i = 0; i < len; i++) {
    const res = results[i] as SpeechRecognitionResult;
    const transcript = String(res?.[0]?.transcript ?? "").trim();
    if (!transcript) continue;

    // Index order = engine emission order. Do not separate final/interim buckets.
    hypothesis = mergeTranscriptWithOverlap(hypothesis, transcript);

    if (res.isFinal) {
      finalsText = mergeTranscriptWithOverlap(finalsText, transcript);
    }
  }

  const lastResult = results[len - 1] as SpeechRecognitionResult | undefined;
  const lastFinal = !!lastResult?.isFinal;

  return {
    hypothesis: hypothesis.trim(),
    finalsOnly: finalsText.trim(),
    lastFinal,
  };
}
