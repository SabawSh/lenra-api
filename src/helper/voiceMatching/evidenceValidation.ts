import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import { spokenMatchesCachedForm } from "@/helper/speech/voiceMatchLexicon";
import { hardLexicalEvidenceMatch } from "./lexicalMatch";
import { contentWords, evidenceTokens, isStopwordOnlyTile } from "./stopwords";
import { normalizeToken } from "./textUtils";
import type { GateResult } from "./types";
import { findVariantSpan } from "./variantSpanMatch";

export type EvidenceMatch = {
  expected: string;
  spokenIndex: number;
  exact: boolean;
};

export type EvidenceResult = {
  contentMatches: EvidenceMatch[];
  tokenMatches: EvidenceMatch[];
  orderMatches: EvidenceMatch[];
};

const CONTENT_ANCHOR_MIN_LENGTH = 5;

/**
 * Normalize transcript tokens for evidence.
 * Colloquial expansions (gonna → "going to") must become separate tokens so
 * span matching sees real boundaries and never treats "going to" as one atom.
 */
function normalizeWindowTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeToken(token);
    if (!normalized) continue;
    for (const part of normalized.split(/\s+/)) {
      if (part) out.push(part);
    }
  }
  return out;
}

/**
 * Locate `token` in `fullTile` at or after `from`, skipping earlier tokens
 * (e.g. stopwords omitted from a content-filtered expected list).
 */
function indexInFullTile(
  fullTile: readonly string[],
  from: number,
  token: string,
): number {
  const want = normalizeToken(token);
  for (let index = Math.max(0, from); index < fullTile.length; index++) {
    if (fullTile[index] === want) return index;
  }
  return -1;
}

function markAnchor(
  expectedNorm: string,
  spokenNorm: string,
  anchorSeen: boolean,
): boolean {
  if (anchorSeen) return true;
  return (
    expectedNorm.length >= CONTENT_ANCHOR_MIN_LENGTH ||
    spokenNorm.length >= CONTENT_ANCHOR_MIN_LENGTH
  );
}

/**
 * Ordered expected→spoken evidence walk.
 * Flow per candidate: exact → cached forms (incl. bounded variant spans) → lexical.
 *
 * `fullTileTokens` enables N-expected lookahead when `expectedTokens` is
 * content-filtered (e.g. "going" with following stopword "to").
 */
function orderedEvidenceMatches(
  expectedTokens: readonly string[],
  windowTokens: readonly string[],
  anchorMatched: boolean,
  lexicon?: VoiceMatchLexicon,
  fullTileTokens?: readonly string[],
): EvidenceMatch[] {
  const matches: EvidenceMatch[] = [];
  let searchFrom = 0;
  let anchorSeen = false;
  let tileCursor = 0;

  let expectedIndex = 0;
  while (expectedIndex < expectedTokens.length) {
    const expected = expectedTokens[expectedIndex] ?? "";
    const expectedNorm = normalizeToken(expected);
    if (!expectedNorm) {
      expectedIndex += 1;
      continue;
    }

    let found: EvidenceMatch | null = null;
    let expectedAdvance = 1;
    let spokenEnd = -1;

    const tileStart =
      fullTileTokens && fullTileTokens.length > 0
        ? indexInFullTile(fullTileTokens, tileCursor, expectedNorm)
        : expectedIndex;
    const spanExpectedTokens =
      fullTileTokens && tileStart >= 0 ? fullTileTokens : expectedTokens;
    const spanExpectedStart =
      fullTileTokens && tileStart >= 0 ? tileStart : expectedIndex;

    for (let index = searchFrom; index < windowTokens.length; index++) {
      const spoken = windowTokens[index] ?? "";
      const spokenNorm = normalizeToken(spoken);
      if (!spokenNorm) continue;

      // 1. Exact 1↔1
      if (spokenNorm === expectedNorm) {
        anchorSeen = markAnchor(expectedNorm, spokenNorm, anchorSeen);
        found = { expected: expectedNorm, spokenIndex: index, exact: true };
        expectedAdvance = 1;
        spokenEnd = index;
        break;
      }

      // 2a. Cached lexicon forms 1↔1
      if (spokenMatchesCachedForm(lexicon, expected, spoken)) {
        anchorSeen = markAnchor(expectedNorm, spokenNorm, anchorSeen);
        found = { expected: expectedNorm, spokenIndex: index, exact: false };
        expectedAdvance = 1;
        spokenEnd = index;
        break;
      }

      // 2b. Cached variant spans (N↔1 / 1↔N), bounded to 3 tokens
      const span = findVariantSpan(
        spanExpectedTokens,
        spanExpectedStart,
        windowTokens,
        index,
        lexicon,
      );
      if (span) {
        const spokenJoined = Array.from({ length: span.spokenLen }, (_, offset) =>
          normalizeToken(windowTokens[index + offset] ?? ""),
        ).join(" ");
        anchorSeen = markAnchor(expectedNorm, spokenJoined, anchorSeen);

        // How many items in expectedTokens does this span cover?
        if (spanExpectedTokens === expectedTokens) {
          expectedAdvance = span.expectedLen;
        } else {
          // Content-filtered list: count leading span tokens present as
          // consecutive upcoming expectedTokens entries.
          let advance = 0;
          for (let offset = 0; offset < span.expectedLen; offset++) {
            const part = spanExpectedTokens[spanExpectedStart + offset] ?? "";
            const nextExpected = normalizeToken(
              expectedTokens[expectedIndex + advance] ?? "",
            );
            if (part && part === nextExpected) {
              advance += 1;
            } else {
              break;
            }
          }
          expectedAdvance = Math.max(1, advance);
        }

        found = {
          expected: expectedNorm,
          spokenIndex: index,
          exact: false,
        };
        spokenEnd = index + span.spokenLen - 1;
        break;
      }

      // 3. Hard lexical equivalence 1↔1. This gate authorizes a tier-1
      // GATE_MATCH, so one-edit spelling similarity is not enough — distinct
      // minimal pairs ("mouse"/"house") would satisfy it. Such pairs are left
      // to the phonetic tiers.
      const allowLexical = anchorMatched || anchorSeen;
      if (allowLexical && hardLexicalEvidenceMatch(expected, spoken, lexicon)) {
        found = { expected: expectedNorm, spokenIndex: index, exact: false };
        expectedAdvance = 1;
        spokenEnd = index;
        break;
      }
    }

    if (!found || spokenEnd < 0) return matches;

    for (let offset = 0; offset < expectedAdvance; offset++) {
      const token = normalizeToken(expectedTokens[expectedIndex + offset] ?? "");
      if (!token) continue;
      matches.push({
        expected: token,
        spokenIndex: found.spokenIndex,
        exact: found.exact && offset === 0,
      });
    }

    if (fullTileTokens && tileStart >= 0) {
      const spanOnTile = findVariantSpan(
        fullTileTokens,
        tileStart,
        windowTokens,
        found.spokenIndex,
        lexicon,
      );
      tileCursor =
        tileStart + (spanOnTile?.expectedLen ?? 1);
    }

    expectedIndex += expectedAdvance;
    searchFrom = spokenEnd + 1;
  }

  return matches;
}

function hasAnchorInWindow(
  required: readonly string[],
  windowTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
  fullTileTokens?: readonly string[],
): boolean {
  return required.some((word) => {
    if (word.length < CONTENT_ANCHOR_MIN_LENGTH) return false;
    const tileStart =
      fullTileTokens && fullTileTokens.length > 0
        ? indexInFullTile(fullTileTokens, 0, word)
        : 0;
    const spanTokens = fullTileTokens && tileStart >= 0 ? fullTileTokens : [word];
    const spanStart = fullTileTokens && tileStart >= 0 ? tileStart : 0;

    return windowTokens.some((spoken, spokenIndex) => {
      const spokenNorm = normalizeToken(spoken);
      if (spokenNorm === word) return true;
      if (spokenMatchesCachedForm(lexicon, word, spoken)) return true;

      if (
        findVariantSpan(spanTokens, spanStart, windowTokens, spokenIndex, lexicon)
      ) {
        return true;
      }

      // Anchor may be the trailing token of an N↔1 variant span
      // (e.g. "right" inside "all right" ↔ "alright").
      if (fullTileTokens && tileStart > 0) {
        for (let start = 0; start < tileStart; start++) {
          const span = findVariantSpan(
            fullTileTokens,
            start,
            windowTokens,
            spokenIndex,
            lexicon,
          );
          if (!span) continue;
          const covered = fullTileTokens.slice(start, start + span.expectedLen);
          if (covered.includes(word)) return true;
        }
      }

      // The anchor must independently prove the tile was spoken. Deriving it
      // from one-edit spelling similarity would make it self-satisfying: for a
      // single-token tile the anchor would be granted by the very fuzzy match
      // it is meant to gate.
      return hardLexicalEvidenceMatch(word, spoken, lexicon);
    });
  });
}

function validateContentEvidence(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
): GateResult {
  const required = evidenceTokens(tileTokens);
  if (required.length === 0) return { pass: true };

  const normalizedWindow = normalizeWindowTokens(windowTokens);
  const normalizedTile = tileTokens.map((token) => normalizeToken(token));
  const anchorMatched = hasAnchorInWindow(
    required,
    normalizedWindow,
    lexicon,
    normalizedTile,
  );
  const matches = orderedEvidenceMatches(
    required,
    normalizedWindow,
    anchorMatched,
    lexicon,
    normalizedTile,
  );

  if (matches.length < required.length) {
    return { pass: false, reason: "INSUFFICIENT_EVIDENCE" };
  }

  const registeredVariantSpan = normalizedWindow.some((_, spokenIndex) =>
    Boolean(
      findVariantSpan(
        normalizedTile,
        0,
        normalizedWindow,
        spokenIndex,
        lexicon,
      ),
    ),
  );

  if (
    !isStopwordOnlyTile(tileTokens) &&
    !anchorMatched &&
    !registeredVariantSpan &&
    required.length > 1
  ) {
    return { pass: false, reason: "INSUFFICIENT_EVIDENCE" };
  }

  return { pass: true };
}

function validateTokenEvidence(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
): GateResult {
  const normalizedTile = tileTokens.map((token) => normalizeToken(token));
  const normalizedWindow = normalizeWindowTokens(windowTokens);

  if (isStopwordOnlyTile(tileTokens)) {
    const matches = orderedEvidenceMatches(
      normalizedTile,
      normalizedWindow,
      false,
      lexicon,
      normalizedTile,
    );
    if (matches.length < normalizedTile.length) {
      return { pass: false, reason: "INSUFFICIENT_EVIDENCE" };
    }
    return { pass: true };
  }

  const requiredCount = Math.max(1, Math.ceil(normalizedTile.length * 0.5));
  const anchorMatched = hasAnchorInWindow(
    contentWords(tileTokens),
    normalizedWindow,
    lexicon,
    normalizedTile,
  );
  const matches = orderedEvidenceMatches(
    normalizedTile,
    normalizedWindow,
    anchorMatched,
    lexicon,
    normalizedTile,
  );

  if (matches.length < requiredCount) {
    return { pass: false, reason: "INSUFFICIENT_EVIDENCE" };
  }

  return { pass: true };
}

function validateOrderEvidence(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
): GateResult {
  const normalizedTile = tileTokens.map((token) => normalizeToken(token));
  const normalizedWindow = normalizeWindowTokens(windowTokens);
  const required = evidenceTokens(tileTokens);
  const targets = required.length > 0 ? required : normalizedTile;
  const anchorMatched = hasAnchorInWindow(
    required.length > 0 ? required : contentWords(tileTokens),
    normalizedWindow,
    lexicon,
    normalizedTile,
  );
  const matches = orderedEvidenceMatches(
    targets,
    normalizedWindow,
    anchorMatched,
    lexicon,
    normalizedTile,
  );

  if (matches.length < targets.length) {
    return { pass: false, reason: "INSUFFICIENT_EVIDENCE" };
  }

  for (let index = 1; index < matches.length; index++) {
    const previous = matches[index - 1]!;
    const current = matches[index]!;
    // Equal spokenIndex is allowed for N-expected ↔ 1-spoken variant spans.
    if (current.spokenIndex < previous.spokenIndex) {
      return { pass: false, reason: "INSUFFICIENT_EVIDENCE" };
    }
  }

  return { pass: true };
}

export function validateEvidence(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
  lexicon?: VoiceMatchLexicon,
): GateResult & { details?: EvidenceResult } {
  const normalizedWindow = normalizeWindowTokens(windowTokens);
  const normalizedTile = tileTokens.map((token) => normalizeToken(token));
  const required = evidenceTokens(tileTokens);

  const contentGate = validateContentEvidence(tileTokens, windowTokens, lexicon);
  if (!contentGate.pass) return contentGate;

  const tokenGate = validateTokenEvidence(tileTokens, windowTokens, lexicon);
  if (!tokenGate.pass) return tokenGate;

  const orderGate = validateOrderEvidence(tileTokens, windowTokens, lexicon);
  if (!orderGate.pass) return orderGate;

  const anchorMatched = hasAnchorInWindow(
    required,
    normalizedWindow,
    lexicon,
    normalizedTile,
  );
  const contentMatches = orderedEvidenceMatches(
    required,
    normalizedWindow,
    anchorMatched,
    lexicon,
    normalizedTile,
  );

  const tokenMatches = orderedEvidenceMatches(
    normalizedTile,
    normalizedWindow,
    anchorMatched,
    lexicon,
    normalizedTile,
  );

  const orderTargets = required.length > 0 ? required : normalizedTile;

  const orderMatches = orderedEvidenceMatches(
    orderTargets,
    normalizedWindow,
    anchorMatched,
    lexicon,
    normalizedTile,
  );

  return {
    pass: true,
    details: {
      contentMatches,
      tokenMatches,
      orderMatches,
    },
  };
}

export function validateSpeechSpanForShortTile(
  tileTokens: readonly string[],
  windowTokens: readonly string[],
): GateResult {
  const tileContent = contentWords(tileTokens);
  if (tileContent.length !== 1) return { pass: true };
  if (windowTokens.length <= 3) return { pass: true };
  return { pass: false, reason: "SPEECH_TOO_LONG" };
}
