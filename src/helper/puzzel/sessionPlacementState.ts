/**
 * Append-only session placement owner.
 *
 * Invariants:
 * - I1: Tile identity stays sticky once committed. Span may rebind when STT
 *   rewrites the hypothesis using matcher-equivalent phrase equality (not a
 *   stricter exact-literal scan). If the words are gone, the span detaches but
 *   the tile stays selected. commitSeq may be rewritten so UI order follows the
 *   latest transcript speech positions (not first-recognition time).
 * - I2: New snapshots only append unsolved tiles; never reopen solved ones.
 * - I3: UI order is commitSeq, aligned to current transcript speech order for
 *   attached placements (never span length).
 * - I4/I5: Consumed spans are hard-reserved while still attached/aligned.
 * - I6: Interim preparePrior never drops stickies (detach instead). Permanent
 *   removal is only longer-literal prefix eviction, or purgeDetachedPlacements
 *   on final commitment when a sticky is still detached.
 */
import type { PuzzlePart } from "@/types/puzzle";
import { normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import { logCandidateRejection } from "@/helper/voiceMatching/placementPipelineTrace";
import { logPlacementOrder } from "@/helper/voiceMatching/placementOrderTrace";
import {
  isLifecycleWatchTileText,
  logTileLifecycle,
} from "@/helper/voiceMatching/tileLifecycleTrace";
import { placementOrderTraceEnabled } from "@/helper/voiceMatching/placementOrderTrace";
import {
  findMatcherEquivalentPrefixSpan,
  findMatcherEquivalentSpan,
} from "@/helper/voiceMatching/matcherEquivalentSpan";
import {
  containedTokenOffsets,
  isAmbiguousOverlapSpan,
  isProperTokenPrefix,
  longerOverlapExtensions,
} from "@/helper/voiceMatching/prefixAmbiguity";
import { tokenizeTileText } from "@/helper/voiceMatching/textUtils";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";

export type PlacementSource = "strict";

export type MatchedSpan = {
  start: number;
  end: number;
};

export type SessionPlacementEntry = {
  tileId: string;
  /** Frozen acceptance order — sole UI sort key. */
  commitSeq: number;
  /** Frozen alias of matchedSpan.start at commit (compat / debug). */
  speechIndex: number;
  matchedSpan: MatchedSpan;
  matchedTokenIndices: number[];
  tileTokenCount: number;
  confidence: number;
  source: PlacementSource;
  /** Transcript tokens at the span when committed (frozen). */
  spokenTokens?: readonly string[];
  /**
   * Recognized but still ambiguous: this tile's text is a proper prefix of an
   * unsolved tile and the spoken evidence cannot yet tell them apart (e.g. "mud"
   * while "mud facials" is unsolved). Provisional entries are selected and own
   * their tile, but reserve their tokens only softly, so a continuation of the
   * longer phrase can still be recognized and supersede them.
   * Recomputed from evidence every pass — never a one-way latch.
   */
  provisional?: boolean;
};

export type SessionPlacementState = {
  placedTiles: Map<string, SessionPlacementEntry>;
  nextCommitSeq: number;
};

/** Matcher proposal — commitSeq assigned only on append. */
export type PlacementProposal = {
  tileId: string;
  matchedSpan: MatchedSpan;
  matchedTokenIndices: number[];
  tileTokenCount: number;
  confidence: number;
  source: PlacementSource;
  spokenTokens?: readonly string[];
  /** Ignored for ordering; kept for older call sites. */
  speechIndex?: number;
};

export type ReducePlacementOptions = {
  transcriptTokens?: readonly string[];
  tileTextById?: ReadonlyMap<string, string>;
};

export function createEmptySessionPlacementState(): SessionPlacementState {
  return { placedTiles: new Map(), nextCommitSeq: 0 };
}

function spanIndices(span: MatchedSpan): number[] {
  const indices: number[] = [];
  for (let index = span.start; index <= span.end; index++) {
    indices.push(index);
  }
  return indices;
}

function spanLength(span: MatchedSpan): number {
  return span.end - span.start + 1;
}

function spansOverlap(left: MatchedSpan, right: MatchedSpan): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function tokensAtSpan(
  transcriptTokens: readonly string[],
  span: MatchedSpan,
): string[] {
  if (span.start < 0 || span.end >= transcriptTokens.length) return [];
  return transcriptTokens.slice(span.start, span.end + 1);
}

/**
 * Normalize legacy / partial prior state into append-only shape without
 * mutating spans or reordering commits.
 */
export function freezePlacementState(
  prior: SessionPlacementState,
): SessionPlacementState {
  const placedTiles = new Map<string, SessionPlacementEntry>();
  let maxSeq = -1;

  const entries = [...prior.placedTiles.values()].sort((left, right) => {
    const leftSeq = left.commitSeq ?? left.speechIndex ?? 0;
    const rightSeq = right.commitSeq ?? right.speechIndex ?? 0;
    if (leftSeq !== rightSeq) return leftSeq - rightSeq;
    return left.tileId.localeCompare(right.tileId);
  });

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const commitSeq = entry.commitSeq ?? index;
    maxSeq = Math.max(maxSeq, commitSeq);
    placedTiles.set(entry.tileId, {
      ...entry,
      commitSeq,
      speechIndex: entry.matchedSpan.start,
      matchedTokenIndices:
        entry.matchedTokenIndices.length > 0
          ? entry.matchedTokenIndices
          : spanIndices(entry.matchedSpan),
    });
  }

  const nextCommitSeq = Math.max(
    prior.nextCommitSeq ?? 0,
    maxSeq + 1,
    placedTiles.size,
  );

  return { placedTiles, nextCommitSeq };
}

function spanMatchesExpected(
  transcriptTokens: readonly string[],
  span: MatchedSpan,
  expected: readonly string[],
): boolean {
  if (expected.length === 0) return false;
  if (span.end - span.start + 1 !== expected.length) return false;
  if (span.start < 0 || span.end >= transcriptTokens.length) return false;
  for (let offset = 0; offset < expected.length; offset++) {
    if (
      normalizeToken(transcriptTokens[span.start + offset] ?? "") !==
      expected[offset]
    ) {
      return false;
    }
  }
  return true;
}

/** True when the sticky span still points at the same spoken evidence. */
function stickySpanStillAligned(
  transcriptTokens: readonly string[],
  entry: SessionPlacementEntry,
  expected: readonly string[],
): boolean {
  if (spanMatchesExpected(transcriptTokens, entry.matchedSpan, expected)) {
    return true;
  }
  const spoken = entry.spokenTokens;
  if (!spoken || spoken.length === 0) return false;
  // Partial prefix locks must fall through to rebind so they can expand
  // when STT grows "I" → "I almost" again.
  if (spoken.length !== expected.length) return false;
  // Spoken lock must still be the tile's own words — never keep owning a
  // foreign token a fuzzy match stole (e.g. tile "I" stuck on "it").
  if (
    !spoken.every(
      (token, index) => normalizeToken(token) === (expected[index] ?? ""),
    )
  ) {
    return false;
  }
  const atSpan = tokensAtSpan(transcriptTokens, entry.matchedSpan);
  if (atSpan.length !== spoken.length) return false;
  return spoken.every(
    (token, index) =>
      normalizeToken(atSpan[index] ?? "") === normalizeToken(token),
  );
}

/**
 * When the full sticky phrase is temporarily missing (Chrome shrinks
 * "I almost" → "I"), keep owning the longest remaining expected prefix so a
 * shorter tile cannot steal those tokens and stack in the UI.
 * Uses matcher-equivalent equality (exact + variant), not a stricter scan.
 */
function findFreeExpectedPrefixSpan(
  transcriptTokens: readonly string[],
  expectedTokens: readonly string[],
  preferredStart: number,
  consumed: ReadonlySet<number>,
  lexicon?: VoiceMatchLexicon,
): MatchedSpan | null {
  return findMatcherEquivalentPrefixSpan(
    transcriptTokens,
    expectedTokens,
    preferredStart,
    consumed,
    lexicon,
  );
}

/** Sticky span no longer maps onto the live transcript (STT rewrite). */
function isDetachedSpan(span: MatchedSpan): boolean {
  return span.start < 0 || span.end < span.start;
}

function detachStickyEntry(entry: SessionPlacementEntry): SessionPlacementEntry {
  return {
    ...entry,
    matchedSpan: { start: -1, end: -1 },
    matchedTokenIndices: [],
  };
}

/**
 * Freeze prior placements, then repair locks invalidated by STT hypothesis
 * rewrites. Committed tiles are NOT re-recognized with a stricter exact-literal
 * scan than the matcher: rebound uses matcher-equivalent phrase equality
 * (validateEvidence + alignment, including whoever ↔ who ever).
 * If evidence is gone, the tile stays selected but its span detaches.
 */
export function preparePriorPlacementForMatching(
  prior: SessionPlacementState,
  transcriptTokens: readonly string[],
  tileTextById: ReadonlyMap<string, string>,
  lexicon?: VoiceMatchLexicon,
): SessionPlacementState {
  const frozen = freezePlacementState(prior);
  if (transcriptTokens.length === 0 || frozen.placedTiles.size === 0) {
    return frozen;
  }

  const placedTiles = new Map<string, SessionPlacementEntry>();

  for (const entry of orderedEntriesFromSessionState(frozen)) {
    const tileText = tileTextById.get(entry.tileId) ?? "";
    const expected = expectedTileTokens(tileText);
    const watch = isLifecycleWatchTileText(tileText);
    const transcriptLabel = transcriptTokens.join(" ");

    if (
      !isDetachedSpan(entry.matchedSpan) &&
      stickySpanStillAligned(transcriptTokens, entry, expected)
    ) {
      placedTiles.set(entry.tileId, entry);
      if (watch) {
        logTileLifecycle({
          phase: "preparePrior / still aligned",
          functionName: "preparePriorPlacementForMatching",
          reason: "KEEP_ALIGNED — sticky span still matches expected/spoken lock",
          tileId: entry.tileId,
          tileText,
          commitSeq: entry.commitSeq,
          attachment: "attached",
          transcript: transcriptLabel,
          matchedSpan: entry.matchedSpan,
          matchedTokenIndices: entry.matchedTokenIndices,
        });
      }
      continue;
    }

    if (watch) {
      logTileLifecycle({
        phase: "preparePrior / needs repair",
        functionName: "preparePriorPlacementForMatching",
        reason:
          "REPAIR_NEEDED — stickySpanStillAligned=false; matcher-equivalent rebound",
        tileId: entry.tileId,
        tileText,
        commitSeq: entry.commitSeq,
        attachment: isDetachedSpan(entry.matchedSpan) ? "detached" : "attached",
        transcript: transcriptLabel,
        matchedSpan: entry.matchedSpan,
        matchedTokenIndices: entry.matchedTokenIndices,
        extras: [
          `tile tokens: ${JSON.stringify(expected)}`,
          `transcript tokens: ${JSON.stringify(transcriptTokens.map((t) => normalizeToken(t)))}`,
          `prior spokenTokens: ${JSON.stringify(entry.spokenTokens ?? [])}`,
        ],
      });
    }

    const consumed = consumedIndicesFromPlaced(placedTiles);
    const preferredStart = isDetachedSpan(entry.matchedSpan)
      ? 0
      : entry.matchedSpan.start;
    const rebound =
      expected.length > 0
        ? findMatcherEquivalentSpan(
            transcriptTokens,
            expected,
            preferredStart,
            consumed,
            lexicon,
          )
        : null;

    if (watch) {
      logTileLifecycle({
        phase: "literal lookup",
        functionName: "preparePriorPlacementForMatching/findMatcherEquivalentSpan",
        reason: rebound
          ? "MATCHER_EQUIVALENT_SPAN_FOUND"
          : "MATCHER_EQUIVALENT_SPAN_NULL — phrase absent under matcher equality",
        tileId: entry.tileId,
        tileText,
        commitSeq: entry.commitSeq,
        attachment: rebound ? "attached" : "absent",
        transcript: transcriptLabel,
        literalSpan: rebound,
        matchedSpan: rebound,
        matchedTokenIndices: rebound ? spanIndices(rebound) : [],
        extras: [
          `tile tokens: ${JSON.stringify(expected)}`,
          `transcript tokens: ${JSON.stringify(transcriptTokens.map((t) => normalizeToken(t)))}`,
          `expected literal span: matcher-equivalent full tile`,
          `actual literal span: ${
            rebound ? `[${rebound.start},${rebound.end}]` : "null"
          }`,
        ],
      });
    }

    if (rebound) {
      const repaired = {
        ...entry,
        matchedSpan: { start: rebound.start, end: rebound.end },
        speechIndex: rebound.start,
        matchedTokenIndices: spanIndices(rebound),
        spokenTokens: tokensAtSpan(transcriptTokens, rebound),
      };
      placedTiles.set(entry.tileId, repaired);
      if (watch) {
        logTileLifecycle({
          phase: "preparePrior / repair",
          functionName: "preparePriorPlacementForMatching",
          reason:
            "REBOUND — matcher-equivalent span restored (same equality as evaluateTile)",
          tileId: entry.tileId,
          tileText,
          commitSeq: entry.commitSeq,
          attachment: "attached",
          transcript: transcriptLabel,
          literalSpan: rebound,
          matchedSpan: repaired.matchedSpan,
          matchedTokenIndices: repaired.matchedTokenIndices,
        });
      }
      continue;
    }

    const prefixHold =
      expected.length > 1
        ? findFreeExpectedPrefixSpan(
            transcriptTokens,
            expected,
            preferredStart,
            consumed,
            lexicon,
          )
        : null;

    if (prefixHold) {
      const held = {
        ...entry,
        matchedSpan: { start: prefixHold.start, end: prefixHold.end },
        speechIndex: prefixHold.start,
        matchedTokenIndices: spanIndices(prefixHold),
        // Prefix-only spoken lock — stickySpanStillAligned will not treat this
        // as a full-tile align, so we can expand when the phrase returns.
        spokenTokens: tokensAtSpan(transcriptTokens, prefixHold),
      };
      placedTiles.set(entry.tileId, held);
      if (watch) {
        logTileLifecycle({
          phase: "preparePrior / prefix-hold",
          functionName: "preparePriorPlacementForMatching",
          reason: "PREFIX_HOLD — partial expected prefix still present",
          tileId: entry.tileId,
          tileText,
          commitSeq: entry.commitSeq,
          attachment: "attached",
          transcript: transcriptLabel,
          literalSpan: prefixHold,
          matchedSpan: held.matchedSpan,
          matchedTokenIndices: held.matchedTokenIndices,
        });
      }
      continue;
    }

    // Evidence temporarily missing under STT rewrite → keep selected, unlock
    // tokens (detach). Final commitment may purge still-detached stickies.
    const detached = detachStickyEntry(entry);
    placedTiles.set(entry.tileId, detached);
    if (watch) {
      logTileLifecycle({
        phase: "detached",
        functionName: "preparePriorPlacementForMatching",
        reason:
          "DETACH — matcher-equivalent rebound null AND prefix-hold null; tile stays in placedTiles",
        tileId: entry.tileId,
        tileText,
        commitSeq: entry.commitSeq,
        attachment: "detached",
        transcript: transcriptLabel,
        literalSpan: null,
        matchedSpan: detached.matchedSpan,
        matchedTokenIndices: detached.matchedTokenIndices,
        extras: [
          `tile tokens: ${JSON.stringify(expected)}`,
          `transcript tokens: ${JSON.stringify(transcriptTokens.map((t) => normalizeToken(t)))}`,
        ],
      });
    }
  }

  refreshProvisionalPrefixFlags(placedTiles, transcriptTokens, tileTextById);

  return {
    placedTiles,
    nextCommitSeq: frozen.nextCommitSeq,
  };
}

function proposalsOverlap(
  left: PlacementProposal,
  right: PlacementProposal,
): boolean {
  return spansOverlap(left.matchedSpan, right.matchedSpan);
}

/**
 * Resolver must deliver conflict-free proposals. Placement never arbitrates meaning.
 */
function assertConflictFreeProposals(proposals: readonly PlacementProposal[]): void {
  if (
    process.env.VOICE_MATCH_DEBUG !== "1" &&
    process.env.NODE_ENV === "production"
  ) {
    return;
  }
  for (let leftIndex = 0; leftIndex < proposals.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < proposals.length; rightIndex++) {
      const left = proposals[leftIndex]!;
      const right = proposals[rightIndex]!;
      if (proposalsOverlap(left, right)) {
        const message =
          `[placement] invariant violation: overlapping resolver proposals ` +
          `${left.tileId}@${left.matchedSpan.start}-${left.matchedSpan.end} vs ` +
          `${right.tileId}@${right.matchedSpan.start}-${right.matchedSpan.end}`;
        if (process.env.VOICE_MATCH_DEBUG === "1") {
          throw new Error(message);
        }
        console.warn(message);
      }
    }
  }
}

function normalizeToken(token: string): string {
  return normalizeText(token);
}

/** Observe-only: why findFreeLiteralSpan misses for "Who ever laid". */
function isLiteralSpanProbeTile(tileText: string): boolean {
  return normalizeText(tileText) === "who ever laid";
}

/**
 * Explain the first token mismatch that makes an exact literal scan fail.
 * findFreeLiteralSpan requires equal-length consecutive identity — it does not
 * use variant N↔1 forms (unlike evaluateTile / alignTileToWindow).
 */
function explainLiteralSpanFailure(
  transcriptTokens: readonly string[],
  expectedTokens: readonly string[],
  consumed: ReadonlySet<number>,
): string[] {
  const lines: string[] = [];
  if (expectedTokens.length === 0) {
    lines.push("fail: expectedTokens is empty");
    return lines;
  }
  if (expectedTokens.length > transcriptTokens.length) {
    lines.push(
      `fail: expected length ${expectedTokens.length} > transcript length ${transcriptTokens.length}`,
    );
    return lines;
  }

  let anyLengthOkStart = false;
  let firstMismatch: string | null = null;
  let blockedOnlyByConsumed = false;

  for (
    let start = 0;
    start <= transcriptTokens.length - expectedTokens.length;
    start++
  ) {
    let mismatchAt: string | null = null;
    for (let offset = 0; offset < expectedTokens.length; offset++) {
      const expected = expectedTokens[offset] ?? "";
      const actual = normalizeToken(transcriptTokens[start + offset] ?? "");
      if (actual !== expected) {
        mismatchAt =
          `start=${start} offset=${offset}: expectedToken=${JSON.stringify(expected)} !== transcriptToken=${JSON.stringify(actual)} (raw=${JSON.stringify(transcriptTokens[start + offset] ?? "")})`;
        break;
      }
    }
    if (mismatchAt) {
      if (!firstMismatch) firstMismatch = mismatchAt;
      continue;
    }
    anyLengthOkStart = true;
    const span = { start, end: start + expectedTokens.length - 1 };
    if (spanIndices(span).some((index) => consumed.has(index))) {
      blockedOnlyByConsumed = true;
      lines.push(
        `tokens matched at start=${start} but span blocked by consumed indices`,
      );
      continue;
    }
  }

  if (!anyLengthOkStart && firstMismatch) {
    lines.push(`first token comparison failure: ${firstMismatch}`);
  } else if (blockedOnlyByConsumed) {
    lines.push("fail: every exact match was consumed");
  } else if (!firstMismatch) {
    lines.push("fail: unknown (no candidate starts scanned)");
  }
  return lines;
}

function logFindFreeLiteralSpanProbe(input: {
  caller: string;
  tileText: string;
  transcriptTokens: readonly string[];
  expectedTokens: readonly string[];
  literalSpan: MatchedSpan | null;
  consumed: ReadonlySet<number>;
}): void {
  if (!placementOrderTraceEnabled()) return;
  if (!isLiteralSpanProbeTile(input.tileText)) return;

  const transcriptJoined = input.transcriptTokens.join(" ");
  const extras = [
    `tile tokens (expected): ${JSON.stringify(input.expectedTokens)}`,
    `transcript tokens: ${JSON.stringify(input.transcriptTokens.map((t) => normalizeToken(t)))}`,
    `tokenizeTileText(tile.text): ${JSON.stringify(tokenize(input.tileText))}`,
    `tokenizeTranscript(transcript): ${JSON.stringify(tokenize(transcriptJoined))}`,
    `expected literal span length: ${input.expectedTokens.length}`,
    `actual literal span: ${
      input.literalSpan
        ? `[${input.literalSpan.start},${input.literalSpan.end}]`
        : "null"
    }`,
  ];
  if (input.literalSpan == null) {
    extras.push(
      ...explainLiteralSpanFailure(
        input.transcriptTokens,
        input.expectedTokens,
        input.consumed,
      ),
    );
  }

  logTileLifecycle({
    phase: "literal lookup",
    functionName: input.caller,
    reason:
      input.literalSpan == null
        ? "LITERAL_SPAN_NULL — exact token identity failed"
        : "LITERAL_SPAN_FOUND",
    tileText: input.tileText,
    attachment: input.literalSpan == null ? "absent" : "attached",
    transcript: transcriptJoined,
    literalSpan: input.literalSpan,
    matchedSpan: input.literalSpan,
    matchedTokenIndices: input.literalSpan
      ? spanIndices(input.literalSpan)
      : [],
    extras,
  });
}

export function findFreeLiteralSpan(
  transcriptTokens: readonly string[],
  expectedTokens: readonly string[],
  preferredStart: number,
  consumed: ReadonlySet<number>,
): MatchedSpan | null {
  if (expectedTokens.length === 0) return null;
  if (expectedTokens.length > transcriptTokens.length) return null;

  const candidates: MatchedSpan[] = [];
  for (
    let start = 0;
    start <= transcriptTokens.length - expectedTokens.length;
    start++
  ) {
    const matches = expectedTokens.every(
      (token, offset) =>
        normalizeToken(transcriptTokens[start + offset] ?? "") === token,
    );
    if (!matches) continue;
    const span = { start, end: start + expectedTokens.length - 1 };
    if (spanIndices(span).some((index) => consumed.has(index))) continue;
    candidates.push(span);
  }
  if (candidates.length === 0) return null;
  return (
    candidates.find((span) => span.start >= preferredStart) ?? candidates[0]!
  );
}

function findFreeLiteralSpanProbed(
  caller: string,
  tileText: string,
  transcriptTokens: readonly string[],
  expectedTokens: readonly string[],
  preferredStart: number,
  consumed: ReadonlySet<number>,
): MatchedSpan | null {
  const literalSpan = findFreeLiteralSpan(
    transcriptTokens,
    expectedTokens,
    preferredStart,
    consumed,
  );
  logFindFreeLiteralSpanProbe({
    caller,
    tileText,
    transcriptTokens,
    expectedTokens,
    literalSpan,
    consumed,
  });
  return literalSpan;
}

function consumedIndicesFromPlaced(
  placedTiles: Map<string, SessionPlacementEntry>,
): Set<number> {
  const consumed = new Set<number>();
  for (const entry of placedTiles.values()) {
    if (isDetachedSpan(entry.matchedSpan)) continue;
    for (const index of spanIndices(entry.matchedSpan)) {
      consumed.add(index);
    }
  }
  return consumed;
}

/**
 * Re-derive {@link SessionPlacementEntry.provisional} from the current
 * transcript using the matcher's own ambiguity predicate. A placed tile is
 * provisional while its text is contained in a still-unsolved tile that could
 * still cover its span, and the transcript cannot yet decide between them.
 *
 * Containment, not just prefix: "mice" sits inside "The mice asked" without
 * starting it. A partial hypothesis ("the mice") legitimately matches the short
 * tile while the longer one cannot match yet, so committing the short tile
 * definitively would hard-own the token and permanently lock the longer phrase
 * out — the user would have to repeat the sentence.
 *
 * Idempotent and evidence-driven in both directions: once the transcript
 * disambiguates (e.g. "mud mud" — the next token continues no longer tile) or
 * the longer tile leaves the unsolved pool, the entry becomes definitive and
 * regains hard token ownership.
 */
function refreshProvisionalPrefixFlags(
  placedTiles: Map<string, SessionPlacementEntry>,
  transcriptTokens: readonly string[],
  tileTextById: ReadonlyMap<string, string> | undefined,
): void {
  if (!tileTextById || transcriptTokens.length === 0) return;

  const unsolvedTiles = [...tileTextById.entries()]
    .filter(([tileId]) => !placedTiles.has(tileId))
    .map(([id, text]) => ({ id, text }));

  for (const [tileId, entry] of placedTiles) {
    if (isDetachedSpan(entry.matchedSpan)) continue;

    // tokenizeTileText (not expectedTileTokens) so the short side is tokenized
    // exactly like the longer tiles inside longerOverlapExtensions.
    const tileTokens = tokenizeTileText(tileTextById.get(tileId) ?? "");
    const provisional =
      tileTokens.length > 0 &&
      isAmbiguousOverlapSpan({
        span: entry.matchedSpan,
        transcript: transcriptTokens,
        extensions: longerOverlapExtensions({
          tileTokens,
          tileId,
          otherTiles: unsolvedTiles,
        }),
      });

    if ((entry.provisional ?? false) === provisional) continue;
    placedTiles.set(tileId, { ...entry, provisional });
  }
}

function isStrictSpanPrefix(
  shorter: MatchedSpan,
  longer: MatchedSpan,
): boolean {
  return shorter.start === longer.start && shorter.end < longer.end;
}

/**
 * When a longer literal proposal arrives (e.g. "I almost"), evict sticky short
 * tiles that are a proper text/span prefix of it (e.g. earlier final "I").
 * Resolver cannot see already-placed stickies in the unsolved pool.
 */
function evictStickyLiteralPrefixesForProposal(
  placedTiles: Map<string, SessionPlacementEntry>,
  proposal: PlacementProposal,
  proposalSpan: MatchedSpan,
  tileTextById: ReadonlyMap<string, string> | undefined,
): void {
  const proposalText = tileTextById?.get(proposal.tileId);
  const proposalTokens = proposalText ? expectedTileTokens(proposalText) : [];

  for (const [tileId, entry] of [...placedTiles.entries()]) {
    if (tileId === proposal.tileId) continue;

    const stickyText = tileTextById?.get(tileId);
    const stickyTokens = stickyText ? expectedTileTokens(stickyText) : [];

    // Containment, not just prefix: the longer proposal supersedes a sticky
    // tile sitting anywhere inside it ("mice" inside "The mice asked"), not
    // only one that starts it ("mud" inside "mud facials").
    const textIsContained =
      stickyTokens.length > 0 &&
      proposalTokens.length > 0 &&
      containedTokenOffsets(stickyTokens, proposalTokens).length > 0;

    const spanIsPrefix =
      !isDetachedSpan(entry.matchedSpan) &&
      !isDetachedSpan(proposalSpan) &&
      isStrictSpanPrefix(entry.matchedSpan, proposalSpan);

    // Require text containment (general rule). Span overlap alone is
    // insufficient — unrelated tiles can share a start after rewrites.
    if (!textIsContained) continue;
    if (
      !spanIsPrefix &&
      !isDetachedSpan(entry.matchedSpan) &&
      !spansOverlap(entry.matchedSpan, proposalSpan)
    ) {
      continue;
    }

    const stickyWatchText = stickyText ?? "";
    placedTiles.delete(tileId);
    if (isLifecycleWatchTileText(stickyWatchText)) {
      logTileLifecycle({
        phase: "removed",
        functionName: "evictStickyLiteralPrefixesForProposal",
        reason: `REMOVED — literal-prefix eviction by longer proposal ${proposal.tileId}`,
        tileId,
        tileText: stickyWatchText,
        commitSeq: entry.commitSeq,
        attachment: "absent",
        matchedSpan: entry.matchedSpan,
        matchedTokenIndices: entry.matchedTokenIndices,
      });
    }
  }
}

/**
 * Inverse of eviction: reject a short proposal when a sticky longer phrase
 * already owns this evidence (e.g. sticky "I almost" vs new "I").
 */
function isSubsumedByStickyLongerLiteral(
  placedTiles: Map<string, SessionPlacementEntry>,
  proposal: PlacementProposal,
  proposalSpan: MatchedSpan,
  tileTextById: ReadonlyMap<string, string> | undefined,
): boolean {
  const proposalText = tileTextById?.get(proposal.tileId);
  const proposalTokens = proposalText ? expectedTileTokens(proposalText) : [];
  if (proposalTokens.length === 0) return false;

  for (const entry of placedTiles.values()) {
    if (entry.tileId === proposal.tileId) continue;
    if (isDetachedSpan(entry.matchedSpan)) continue;

    const stickyText = tileTextById?.get(entry.tileId);
    const stickyTokens = stickyText ? expectedTileTokens(stickyText) : [];
    if (!isProperTokenPrefix(proposalTokens, stickyTokens)) continue;

    if (
      isStrictSpanPrefix(proposalSpan, entry.matchedSpan) ||
      spansOverlap(proposalSpan, entry.matchedSpan)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Visual order must follow the latest transcript, not first-recognition time.
 * Reassigns commitSeq for attached placements by matchedSpan.start when that
 * order differs from current commitSeq. Sticky ownership / spans unchanged.
 * Detached stickies keep relative order after all attached tiles.
 */
function reorderPlacementsByTranscriptSpeechOrder(
  placedTiles: Map<string, SessionPlacementEntry>,
): { placedTiles: Map<string, SessionPlacementEntry>; nextCommitSeq: number } {
  const attached: SessionPlacementEntry[] = [];
  const detached: SessionPlacementEntry[] = [];
  for (const entry of placedTiles.values()) {
    if (isDetachedSpan(entry.matchedSpan)) detached.push(entry);
    else attached.push(entry);
  }

  if (attached.length <= 1 && detached.length === 0) {
    return {
      placedTiles,
      nextCommitSeq: Math.max(
        0,
        ...[...placedTiles.values()].map((entry) => (entry.commitSeq ?? 0) + 1),
      ),
    };
  }

  const bySpeech = [...attached].sort((left, right) => {
    const startDiff = left.matchedSpan.start - right.matchedSpan.start;
    if (startDiff !== 0) return startDiff;
    const endDiff = left.matchedSpan.end - right.matchedSpan.end;
    if (endDiff !== 0) return endDiff;
    return left.tileId.localeCompare(right.tileId);
  });

  const byCommit = [...attached].sort((left, right) => {
    const seqDiff = (left.commitSeq ?? 0) - (right.commitSeq ?? 0);
    if (seqDiff !== 0) return seqDiff;
    return left.tileId.localeCompare(right.tileId);
  });

  const attachedOrderChanged = bySpeech.some(
    (entry, index) => entry.tileId !== byCommit[index]?.tileId,
  );

  const detachedOrdered = [...detached].sort((left, right) => {
    const seqDiff = (left.commitSeq ?? 0) - (right.commitSeq ?? 0);
    if (seqDiff !== 0) return seqDiff;
    return left.tileId.localeCompare(right.tileId);
  });

  if (!attachedOrderChanged) {
    return {
      placedTiles,
      nextCommitSeq: Math.max(
        0,
        ...[...placedTiles.values()].map((entry) => (entry.commitSeq ?? 0) + 1),
        placedTiles.size,
      ),
    };
  }

  const next = new Map(placedTiles);
  let seq = 0;
  for (const entry of bySpeech) {
    next.set(entry.tileId, { ...entry, commitSeq: seq });
    seq += 1;
  }
  for (const entry of detachedOrdered) {
    next.set(entry.tileId, { ...entry, commitSeq: seq });
    seq += 1;
  }

  logPlacementOrder([
    `[PLACEMENT-ORDER] transcript-aware commitSeq reorder`,
    ...bySpeech.map(
      (entry, index) =>
        `${index}. ${entry.tileId} speechStart=${entry.matchedSpan.start} → commitSeq=${index}`,
    ),
  ]);

  return { placedTiles: next, nextCommitSeq: seq };
}

/**
 * Append-only placement: never mutate, relocate, or delete committed tiles —
 * except longest-literal-prefix eviction of a sticky short tile when a longer
 * literal proposal subsumes it (same rule as the resolver).
 * After append, commitSeq is aligned to current transcript speech order.
 */
export function appendPlacements(
  prev: SessionPlacementState,
  proposals: readonly PlacementProposal[],
  options?: ReducePlacementOptions,
): SessionPlacementState {
  const frozen = freezePlacementState(prev);
  const placedTiles = new Map(frozen.placedTiles);
  let nextCommitSeq = frozen.nextCommitSeq;
  const transcriptTokens = options?.transcriptTokens ?? [];
  const tileTextById = options?.tileTextById;

  assertConflictFreeProposals(proposals);

  const formatOrdered = (state: {
    placedTiles: Map<string, SessionPlacementEntry>;
  }): string[] =>
    orderedEntriesFromSessionState({
      placedTiles: state.placedTiles,
      nextCommitSeq: 0,
    }).map((entry, index) => {
      const text = tileTextById?.get(entry.tileId) ?? "?";
      return `${index}. tileId=${entry.tileId} tileText=${JSON.stringify(text)} commitSeq=${entry.commitSeq} span=${entry.matchedSpan.start}-${entry.matchedSpan.end}`;
    });

  logPlacementOrder([
    `[PLACEMENT-ORDER] 4. appendPlacements() — BEFORE append`,
    `transcript: ${transcriptTokens.join(" ")}`,
    ...formatOrdered({ placedTiles }),
    ``,
    `[PLACEMENT-ORDER] 4. appendPlacements() — proposals (commit order = received / speech order)`,
    ...proposals.map((proposal, index) => {
      const text = tileTextById?.get(proposal.tileId) ?? "?";
      return `${index}. tileId=${proposal.tileId} tileText=${JSON.stringify(text)} span=${proposal.matchedSpan.start}-${proposal.matchedSpan.end}`;
    }),
  ]);

  // Commit in resolver / proposalsFromMatchResult order (speech order).
  // Never re-sort by span length — that mutates commitSeq and UI order.
  for (const proposal of proposals) {
    if (placedTiles.has(proposal.tileId)) {
      logCandidateRejection({
        candidate: proposal.tileId,
        tileId: proposal.tileId,
        reason: "ALREADY_COMMITTED",
        functionName: "appendPlacements",
        condition: "placedTiles.has(tileId) — never replace committed tiles",
      });
      continue;
    }

    let span = proposal.matchedSpan;
    const consumed = consumedIndicesFromPlaced(placedTiles);
    const tileText = tileTextById?.get(proposal.tileId);
    if (tileText && transcriptTokens.length > 0) {
      const expected = expectedTileTokens(tileText);
      const literal = findFreeLiteralSpanProbed(
        "appendPlacements/preEvict",
        tileText,
        transcriptTokens,
        expected,
        proposal.matchedSpan.start,
        consumed,
      );
      if (literal) {
        span = literal;
      }
    }

    const placedBeforePrefixEvict = new Map(placedTiles);

    // Evict sticky "I" before overlap check so "I almost" can commit.
    evictStickyLiteralPrefixesForProposal(
      placedTiles,
      proposal,
      span,
      tileTextById,
    );

    const restorePrefixEvictions = () => {
      for (const [tileId, entry] of placedBeforePrefixEvict) {
        if (!placedTiles.has(tileId)) {
          placedTiles.set(tileId, entry);
        }
      }
    };

    if (
      isSubsumedByStickyLongerLiteral(
        placedTiles,
        proposal,
        span,
        tileTextById,
      )
    ) {
      restorePrefixEvictions();
      logCandidateRejection({
        candidate: proposal.tileId,
        tileId: proposal.tileId,
        reason: "SUBSUMED_BY_LONGER_TILE",
        functionName: "appendPlacements",
        condition:
          "short proposal is a literal prefix of a sticky longer tile span",
        window: {
          start: span.start,
          end: span.end,
          tokens: tokensAtSpan(transcriptTokens, span),
        },
      });
      continue;
    }

    // Recompute after eviction — previously consumed prefix spans are free.
    const overlapsCommitted = [...placedTiles.values()].some((entry) => {
      if (isDetachedSpan(entry.matchedSpan)) return false;
      return spansOverlap(span, entry.matchedSpan);
    });
    if (overlapsCommitted) {
      restorePrefixEvictions();
      logCandidateRejection({
        candidate: proposal.tileId,
        tileId: proposal.tileId,
        reason: "OVERLAP_CONSUMED",
        functionName: "appendPlacements",
        condition: "proposal.matchedSpan overlaps a committed span",
        window: {
          start: span.start,
          end: span.end,
          tokens: tokensAtSpan(transcriptTokens, span),
        },
        consumedSpans: [...placedTiles.values()].map(
          (entry) => entry.matchedSpan,
        ),
      });
      continue;
    }

    // Prefer a free literal now that prefix stickies were cleared.
    if (tileText && transcriptTokens.length > 0) {
      const expected = expectedTileTokens(tileText);
      const literal = findFreeLiteralSpanProbed(
        "appendPlacements/postEvict",
        tileText,
        transcriptTokens,
        expected,
        proposal.matchedSpan.start,
        consumedIndicesFromPlaced(placedTiles),
      );
      if (literal) {
        span = literal;
      }
    }

    const spokenTokens =
      transcriptTokens.length > 0
        ? tokensAtSpan(transcriptTokens, span)
        : proposal.spokenTokens;

    placedTiles.set(proposal.tileId, {
      tileId: proposal.tileId,
      commitSeq: nextCommitSeq,
      speechIndex: span.start,
      matchedSpan: { start: span.start, end: span.end },
      matchedTokenIndices: spanIndices(span),
      tileTokenCount: proposal.tileTokenCount,
      confidence: proposal.confidence,
      source: proposal.source,
      spokenTokens,
    });
    if (isLifecycleWatchTileText(tileText ?? "")) {
      logTileLifecycle({
        phase: "committed",
        functionName: "appendPlacements",
        reason: "COMMITTED — entered placedTiles (sticky / VISIBLE)",
        tileId: proposal.tileId,
        tileText: tileText ?? "",
        commitSeq: nextCommitSeq,
        attachment: "attached",
        transcript: transcriptTokens.join(" "),
        literalSpan: null,
        matchedSpan: { start: span.start, end: span.end },
        matchedTokenIndices: spanIndices(span),
      });
    }
    nextCommitSeq += 1;
  }

  const reordered =
    transcriptTokens.length > 0
      ? reorderPlacementsByTranscriptSpeechOrder(placedTiles)
      : { placedTiles, nextCommitSeq };

  refreshProvisionalPrefixFlags(
    reordered.placedTiles,
    transcriptTokens,
    tileTextById,
  );

  logPlacementOrder([
    `[PLACEMENT-ORDER] 4. appendPlacements() — AFTER append (+ transcript reorder)`,
    ...formatOrdered({ placedTiles: reordered.placedTiles }),
  ]);

  logPlacementOrder([
    `--------------------------------`,
    `APPEND RETURN ORDER`,
    `appendPlacements_speech_order_commit=1`,
    `transcript_aware_reorder=1`,
    ...orderedEntriesFromSessionState({
      placedTiles: reordered.placedTiles,
      nextCommitSeq: reordered.nextCommitSeq,
    }).map((entry) => {
      const text = tileTextById?.get(entry.tileId) ?? entry.tileId;
      return [
        `commitSeq=${entry.commitSeq}`,
        `tileText=${text}`,
        `speechStart=${entry.matchedSpan.start}`,
        `speechEnd=${entry.matchedSpan.end}`,
      ].join("\n");
    }),
    `--------------------------------`,
  ]);

  return {
    placedTiles: reordered.placedTiles,
    nextCommitSeq: reordered.nextCommitSeq,
  };
}

/**
 * @deprecated Use {@link appendPlacements}. Kept as a thin alias so call sites
 * and older tests keep compiling during the append-only migration.
 */
export function reducePlacementState(
  prev: SessionPlacementState,
  proposals: readonly PlacementProposal[],
  options?: ReducePlacementOptions,
): SessionPlacementState {
  return appendPlacements(prev, proposals, options);
}

export function orderedEntriesFromSessionState(
  state: SessionPlacementState,
): SessionPlacementEntry[] {
  return Array.from(state.placedTiles.values()).sort((left, right) => {
    const seqDiff =
      (left.commitSeq ?? left.speechIndex) -
      (right.commitSeq ?? right.speechIndex);
    if (seqDiff !== 0) return seqDiff;
    return left.tileId.localeCompare(right.tileId);
  });
}

export function orderedPuzzlePartsFromSessionState(
  state: SessionPlacementState,
  lookup: readonly PuzzlePart[],
): PuzzlePart[] {
  const byId = new Map(lookup.map((part) => [part.id, part]));

  return orderedEntriesFromSessionState(state)
    .map((entry) => byId.get(entry.tileId))
    .filter((part): part is PuzzlePart => !!part);
}

/**
 * On mic-release / final only: drop stickies that are still detached after
 * preparePrior repair. Interim regressions keep them selected (no flicker);
 * finals must not leave forever-sticky wrong matches with no transcript lock.
 */
export function purgeDetachedPlacements(
  state: SessionPlacementState,
  options?: {
    tileTextById?: ReadonlyMap<string, string>;
    commitmentLevel?: string;
    transcript?: string;
  },
): SessionPlacementState {
  const placedTiles = new Map<string, SessionPlacementEntry>();
  for (const [tileId, entry] of state.placedTiles.entries()) {
    if (isDetachedSpan(entry.matchedSpan)) {
      const tileText = options?.tileTextById?.get(tileId) ?? tileId;
      if (isLifecycleWatchTileText(tileText)) {
        logTileLifecycle({
          phase: "purged",
          functionName: "purgeDetachedPlacements",
          reason:
            "REMOVED — FIRST VISIBLE→NOT VISIBLE: still detached at final; dropped from placedTiles",
          tileId,
          tileText,
          commitSeq: entry.commitSeq,
          attachment: "absent",
          commitmentLevel: options?.commitmentLevel ?? "final",
          transcript: options?.transcript,
          matchedSpan: entry.matchedSpan,
          matchedTokenIndices: entry.matchedTokenIndices,
          literalSpan: null,
        });
      }
      continue;
    }
    placedTiles.set(tileId, entry);
  }
  if (placedTiles.size === state.placedTiles.size) return state;
  return {
    placedTiles,
    nextCommitSeq: state.nextCommitSeq,
  };
}

/**
 * Hard token reservations for the matcher.
 *
 * Detached and provisional placements are excluded. A provisional prefix (e.g.
 * "mud" while "mud facials" is unsolved) must not hard-reserve its tokens, or
 * the longer phrase would be rejected as OVERLAP_CONSUMED before it could ever
 * be proposed. Real conflicts are still rejected by {@link appendPlacements},
 * which only lets a genuine literal extension supersede the short tile.
 */
export function consumedSpansFromSessionState(
  state: SessionPlacementState,
): MatchedSpan[] {
  return Array.from(state.placedTiles.values())
    .filter(
      (entry) => !isDetachedSpan(entry.matchedSpan) && entry.provisional !== true,
    )
    .map((entry) => ({
      ...entry.matchedSpan,
    }));
}

export function sessionStateLineKey(state: SessionPlacementState): string {
  return orderedEntriesFromSessionState(state)
    .map((entry) => entry.tileId)
    .join("|");
}

export function puzzleLineKey(parts: readonly PuzzlePart[]): string {
  return parts.map((part) => part.id).join("|");
}

/** @internal test helper — normalize text tokens the same way as matching. */
export function expectedTileTokens(tileText: string): string[] {
  return tokenize(normalizeText(tileText));
}
