/**
 * Repair / rebind helper that uses the SAME phrase-equality rules as the
 * matcher gate path (validateEvidence + alignTileToWindow + validateAlignment),
 * including variant N↔1 forms (whoever ↔ who ever).
 *
 * preparePrior must never re-recognize committed tiles with a stricter exact
 * literal scan than evaluateTile — that creates two definitions of equality.
 */
import { scoreTokenPhoneticDistance } from "@/helper/speech/phoneticDistance";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import {
  alignTileToWindow,
  validateAlignment,
} from "./alignmentValidation";
import { validateEvidence } from "./evidenceValidation";
import { normalizeToken } from "./textUtils";
import { windowSizesForTile } from "./windows";

export type MatcherEquivalentSpan = {
  start: number;
  end: number;
};

/** ASR confusions for sticky rebind (will↔well, etc.) — same tier as matcher phonetic gate. */
const HOMOPHONE_REBIND_MIN_SIMILARITY = 0.88;

function findSingleTokenHomophoneSpan(
  transcriptTokens: readonly string[],
  tileTokens: readonly string[],
  preferredStart: number,
  consumed: ReadonlySet<number>,
): MatcherEquivalentSpan | null {
  if (tileTokens.length !== 1) return null;
  const expected = normalizeToken(tileTokens[0]!);
  if (!expected) return null;

  const candidates: MatcherEquivalentSpan[] = [];
  for (let start = 0; start < transcriptTokens.length; start++) {
    const spoken = normalizeToken(transcriptTokens[start] ?? "");
    if (!spoken || spoken === expected) continue;
    const { similarity } = scoreTokenPhoneticDistance(expected, spoken);
    if (similarity < HOMOPHONE_REBIND_MIN_SIMILARITY) continue;
    const span = { start, end: start };
    if (spanOverlapsConsumed(span, consumed)) continue;
    candidates.push(span);
  }
  if (candidates.length === 0) return null;
  return (
    candidates.find((span) => span.start >= preferredStart) ?? candidates[0]!
  );
}

function spanIndices(span: MatcherEquivalentSpan): number[] {
  const indices: number[] = [];
  for (let index = span.start; index <= span.end; index++) indices.push(index);
  return indices;
}

function spanOverlapsConsumed(
  span: MatcherEquivalentSpan,
  consumed: ReadonlySet<number>,
): boolean {
  return spanIndices(span).some((index) => consumed.has(index));
}

/** Exact contiguous identity — same rule as findFreeLiteralSpan fast path. */
function findExactIdentitySpan(
  transcriptTokens: readonly string[],
  expectedTokens: readonly string[],
  preferredStart: number,
  consumed: ReadonlySet<number>,
): MatcherEquivalentSpan | null {
  if (expectedTokens.length === 0) return null;
  if (expectedTokens.length > transcriptTokens.length) return null;

  const candidates: MatcherEquivalentSpan[] = [];
  for (
    let start = 0;
    start <= transcriptTokens.length - expectedTokens.length;
    start++
  ) {
    const matches = expectedTokens.every(
      (token, offset) =>
        normalizeToken(transcriptTokens[start + offset] ?? "") ===
        normalizeToken(token),
    );
    if (!matches) continue;
    const span = { start, end: start + expectedTokens.length - 1 };
    if (spanOverlapsConsumed(span, consumed)) continue;
    candidates.push(span);
  }
  if (candidates.length === 0) return null;
  return (
    candidates.find((span) => span.start >= preferredStart) ?? candidates[0]!
  );
}

/**
 * Tight spoken span covering all matched expected tokens under matcher
 * alignment (variant compression may make this shorter than tile token count).
 */
function spanFromAlignment(
  windowStart: number,
  alignmentSpokenIndices: readonly number[],
): MatcherEquivalentSpan | null {
  if (alignmentSpokenIndices.length === 0) return null;
  let min = alignmentSpokenIndices[0]!;
  let max = alignmentSpokenIndices[0]!;
  for (const index of alignmentSpokenIndices) {
    if (index < min) min = index;
    if (index > max) max = index;
  }
  return {
    start: windowStart + min,
    end: windowStart + max,
  };
}

/**
 * Find a free transcript span that the matcher gate would accept for these
 * tile tokens. Prefers exact identity; otherwise evidence+alignment windows
 * (including variant N↔1). Never uses a stricter equality than evaluateTile.
 */
export function findMatcherEquivalentSpan(
  transcriptTokens: readonly string[],
  tileTokens: readonly string[],
  preferredStart: number,
  consumed: ReadonlySet<number>,
  lexicon?: VoiceMatchLexicon,
): MatcherEquivalentSpan | null {
  if (tileTokens.length === 0 || transcriptTokens.length === 0) return null;

  const exact = findExactIdentitySpan(
    transcriptTokens,
    tileTokens,
    preferredStart,
    consumed,
  );
  if (exact) return exact;

  const homophone = findSingleTokenHomophoneSpan(
    transcriptTokens,
    tileTokens,
    preferredStart,
    consumed,
  );
  if (homophone) return homophone;

  const candidates: MatcherEquivalentSpan[] = [];
  const sizes = windowSizesForTile(tileTokens.length);
  // Also allow compressed spoken windows (variant N↔1): down to 1 token.
  for (let size = 1; size < tileTokens.length; size++) {
    if (!sizes.includes(size)) sizes.push(size);
  }
  sizes.sort((left, right) => left - right);

  for (const size of sizes) {
    if (size > transcriptTokens.length) continue;
    for (
      let start = 0;
      start <= transcriptTokens.length - size;
      start++
    ) {
      const end = start + size - 1;
      const windowTokens = transcriptTokens.slice(start, end + 1);
      if (spanOverlapsConsumed({ start, end }, consumed)) continue;

      const evidence = validateEvidence(tileTokens, windowTokens, lexicon);
      if (!evidence.pass) continue;

      const alignment = alignTileToWindow(tileTokens, windowTokens, lexicon);
      if (!validateAlignment(alignment).pass) continue;

      const tight = spanFromAlignment(
        start,
        alignment.alignments.map((row) => row.spokenIndex),
      );
      if (!tight) continue;
      if (spanOverlapsConsumed(tight, consumed)) continue;
      candidates.push(tight);
    }
  }

  if (candidates.length === 0) return null;

  // Prefer spans at/after preferredStart; then tighter (fewer tokens); then earlier.
  const ranked = [...candidates].sort((left, right) => {
    const leftPref = left.start >= preferredStart ? 0 : 1;
    const rightPref = right.start >= preferredStart ? 0 : 1;
    if (leftPref !== rightPref) return leftPref - rightPref;
    const leftWidth = left.end - left.start;
    const rightWidth = right.end - right.start;
    if (leftWidth !== rightWidth) return leftWidth - rightWidth;
    return left.start - right.start;
  });
  return ranked[0]!;
}

/**
 * Longest remaining expected prefix that still matcher-equivalently appears
 * (exact or variant). Used when the full phrase is temporarily incomplete.
 */
export function findMatcherEquivalentPrefixSpan(
  transcriptTokens: readonly string[],
  expectedTokens: readonly string[],
  preferredStart: number,
  consumed: ReadonlySet<number>,
  lexicon?: VoiceMatchLexicon,
): MatcherEquivalentSpan | null {
  for (let length = expectedTokens.length - 1; length >= 1; length--) {
    const prefix = expectedTokens.slice(0, length);
    const span = findMatcherEquivalentSpan(
      transcriptTokens,
      prefix,
      preferredStart,
      consumed,
      lexicon,
    );
    if (span) return span;
  }
  return null;
}
