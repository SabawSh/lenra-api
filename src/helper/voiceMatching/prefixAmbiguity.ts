/**
 * Single source of truth for prefix/overlap ambiguity.
 *
 * A spoken span can be both a complete tile and part of a longer tile. Both the
 * matcher (which defers such a tile on preview) and the placement layer (which
 * marks such a commit provisional) must use the same predicate, so recognition
 * and commitment can never disagree.
 *
 * Two shapes exist, and they are deliberately not the same predicate:
 *
 * - Prefix overlap, where the short tile starts the longer one ("mud" vs
 *   "mud facials"). The matcher may defer these on preview, because both
 *   readings begin at the same spoken token.
 * - General containment, where the short tile sits anywhere inside the longer
 *   one ("mice" inside "The mice asked"). The matcher must NOT defer these —
 *   the short tile is legitimately recognized and should be visible — but the
 *   placement layer must not let it harden into an irreversible commitment
 *   while the longer reading is still alive.
 */
import { normalizeToken, tokenizeTileText } from "./textUtils";

export function isProperTokenPrefix(
  shorter: readonly string[],
  longer: readonly string[],
): boolean {
  if (shorter.length === 0 || shorter.length >= longer.length) return false;
  return shorter.every((token, index) => token === longer[index]);
}

/** Token lists of other tiles whose text strictly extends `tileTokens`. */
export function longerPrefixExtensions(input: {
  tileTokens: readonly string[];
  tileId: string;
  otherTiles: readonly { id: string; text: string }[];
}): string[][] {
  if (input.tileTokens.length === 0) return [];
  return input.otherTiles.flatMap((other) => {
    if (other.id === input.tileId) return [];
    const otherTokens = tokenizeTileText(other.text);
    if (!isProperTokenPrefix(input.tileTokens, otherTokens)) return [];
    return [otherTokens];
  });
}

/**
 * True when the evidence at this span cannot yet decide between the short tile
 * and one of its longer extensions.
 *
 * Ambiguous when the transcript already completes a longer phrase at this
 * start, when the next spoken token continues one, or when the span ends the
 * current hypothesis (the user may still be mid-phrase).
 *
 * Disambiguated otherwise: the first "really" in "really really busy" has next
 * token "really", which continues no longer tile, so it is unambiguous.
 */
export function isAmbiguousPrefixSpan(input: {
  tileTokens: readonly string[];
  span: { start: number; end: number };
  transcript: readonly string[];
  longerTokenLists: readonly (readonly string[])[];
}): boolean {
  if (input.longerTokenLists.length === 0) return false;
  const { span, transcript } = input;

  for (const longer of input.longerTokenLists) {
    if (span.start + longer.length <= transcript.length) {
      const slice = transcript.slice(span.start, span.start + longer.length);
      if (
        slice.every((token, index) => normalizeToken(token) === longer[index]!)
      ) {
        return true;
      }
    }
  }

  const nextIndex = span.end + 1;
  if (nextIndex >= transcript.length) return true;

  const nextToken = normalizeToken(transcript[nextIndex] ?? "");
  return input.longerTokenLists.some(
    (longer) => longer[input.tileTokens.length] === nextToken,
  );
}

/** A longer tile that contains a shorter one, and where inside it that happens. */
export type OverlapExtension = {
  /** Tokens of the longer tile. */
  tokens: string[];
  /** Index in `tokens` where the shorter tile's tokens begin. */
  offset: number;
};

/**
 * Every offset at which `shorter` appears as a contiguous run inside the
 * strictly longer `longer`. Offset 0 is the prefix case.
 */
export function containedTokenOffsets(
  shorter: readonly string[],
  longer: readonly string[],
): number[] {
  if (shorter.length === 0 || shorter.length >= longer.length) return [];

  const offsets: number[] = [];
  for (let start = 0; start + shorter.length <= longer.length; start++) {
    if (shorter.every((token, index) => token === longer[start + index])) {
      offsets.push(start);
    }
  }
  return offsets;
}

/** Other tiles whose text strictly contains `tileTokens`, with the offset. */
export function longerOverlapExtensions(input: {
  tileTokens: readonly string[];
  tileId: string;
  otherTiles: readonly { id: string; text: string }[];
}): OverlapExtension[] {
  if (input.tileTokens.length === 0) return [];

  return input.otherTiles.flatMap((other) => {
    if (other.id === input.tileId) return [];
    const otherTokens = tokenizeTileText(other.text);
    return containedTokenOffsets(input.tileTokens, otherTokens).map(
      (offset) => ({ tokens: otherTokens, offset }),
    );
  });
}

/**
 * True when the transcript so far cannot yet rule out a longer tile that would
 * cover this span, so committing the short tile irreversibly would be premature.
 *
 * The offset anchors where the longer phrase would have to start: a tile
 * containing the short one at offset 2 must begin two tokens earlier. That
 * reading stays alive while everything the transcript already covers agrees
 * with it, and dies as soon as the transcript contradicts it.
 *
 *   alive  — the phrase agrees so far and runs past the end of the hypothesis
 *            (more speech could still complete it), or the transcript already
 *            spells it out in full and the longer tile should take the span.
 *   dead   — the transcript covers where the phrase would sit and disagrees,
 *            or the phrase would have to start before the transcript does.
 *
 * So the first "really" of "really really busy" does not hold open the tile
 * "really busy": token 1 is "really", not "busy". And a bare "mice" does not
 * hold open "The mice asked", because that would need a "the" that was never
 * spoken.
 */
export function isAmbiguousOverlapSpan(input: {
  span: { start: number; end: number };
  transcript: readonly string[];
  extensions: readonly OverlapExtension[];
}): boolean {
  const { span, transcript } = input;

  return input.extensions.some(({ tokens, offset }) => {
    const start = span.start - offset;
    if (start < 0) return false;

    const covered = Math.min(tokens.length, transcript.length - start);
    for (let index = 0; index < covered; index++) {
      if (normalizeToken(transcript[start + index] ?? "") !== tokens[index]) {
        return false;
      }
    }
    return true;
  });
}
