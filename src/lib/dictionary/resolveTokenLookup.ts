import type { DictionaryLookupContext } from "@/lib/dictionary/lookupContext";
import { lookupIndexedSense } from "@/lib/dictionary/senseIndex";
import type { PartToken } from "@/types/video";

/** Minimum token shape for dictionary routing from the learning UI. */
export type DictionaryLookupToken = {
  id?: string;
  text: string;
  senseId?: string;
  dictionaryEntryId?: string;
  matchedPhrase?: string;
};

function optionalTrimmed(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Convert a single token into a dictionary lookup context.
 * Uses `dictionaryEntryId` when present; otherwise falls back to surface `text`.
 */
export function partTokenToLookupContext(
  token: DictionaryLookupToken,
): DictionaryLookupContext {
  const senseId = optionalTrimmed(token.senseId);
  const matchedPhrase = optionalTrimmed(token.matchedPhrase);
  const surfaceWord = optionalTrimmed(token.text);

  let dictionaryEntryId = optionalTrimmed(token.dictionaryEntryId);
  if (!dictionaryEntryId && senseId) {
    dictionaryEntryId = lookupIndexedSense(senseId)?.entryId;
  }

  if (dictionaryEntryId) {
    const context: DictionaryLookupContext = { dictionaryEntryId };
    if (senseId) context.senseId = senseId;
    if (matchedPhrase) context.matchedPhrase = matchedPhrase;
    return context;
  }

  if (senseId) {
    const context: DictionaryLookupContext = { senseId };
    if (matchedPhrase) {
      context.matchedPhrase = matchedPhrase;
      context.word = matchedPhrase;
    } else if (surfaceWord) {
      context.word = surfaceWord;
    }
    return context;
  }

  const word = matchedPhrase ?? surfaceWord;
  if (!word) return {};

  const context: DictionaryLookupContext = { word };
  if (matchedPhrase) context.matchedPhrase = matchedPhrase;
  return context;
}

/**
 * Pick the single underlying part token that should drive dictionary lookup
 * when a puzzle chunk spans multiple tokens.
 */
export function pickRepresentativeLookupToken(
  tokens: readonly DictionaryLookupToken[],
): DictionaryLookupToken | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0];

  const phraseTokens = tokens.filter((token) =>
    optionalTrimmed(token.matchedPhrase),
  );
  if (phraseTokens.length > 0) {
    const phraseEntryIds = new Set(
      phraseTokens
        .map((token) => optionalTrimmed(token.dictionaryEntryId))
        .filter((id): id is string => Boolean(id)),
    );

    if (phraseEntryIds.size === 1) {
      const dictionaryEntryId = [...phraseEntryIds][0];
      return (
        phraseTokens.find(
          (token) =>
            optionalTrimmed(token.dictionaryEntryId) === dictionaryEntryId,
        ) ?? phraseTokens[0]
      );
    }

    if (phraseTokens.length === 1) {
      return phraseTokens[0];
    }

    console.warn(
      "[dictionary] Multiple phrase tokens with conflicting entry ids in puzzle chunk",
      { phraseTokens },
    );
    return phraseTokens[0];
  }

  const entryIds = new Set(
    tokens
      .map((token) => optionalTrimmed(token.dictionaryEntryId))
      .filter((id): id is string => Boolean(id)),
  );

  if (entryIds.size === 1) {
    const dictionaryEntryId = [...entryIds][0];
    return (
      tokens.find(
        (token) =>
          optionalTrimmed(token.dictionaryEntryId) === dictionaryEntryId,
      ) ?? tokens[0]
    );
  }

  if (entryIds.size > 1) {
    console.warn(
      "[dictionary] Conflicting dictionaryEntryIds in puzzle chunk — using first token",
      { entryIds: [...entryIds], tokens },
    );
  }

  return tokens[0];
}

/**
 * Merge dictionary metadata from multiple underlying part tokens (e.g. puzzle chunks).
 */
export function resolveTokensLookupContext(
  tokens: readonly DictionaryLookupToken[],
): DictionaryLookupContext {
  const representative = pickRepresentativeLookupToken(tokens);
  if (!representative) return {};
  return partTokenToLookupContext(representative);
}

function basePartTokenId(puzzleTokenId: string): string {
  const match = /^(.+)#w\d+$/.exec(puzzleTokenId);
  return match ? match[1] : puzzleTokenId;
}

function expandedPuzzleTokenIds(partTokens: readonly PartToken[]): string[] {
  const ids: string[] = [];
  for (const token of partTokens) {
    const words = token.text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
      ids.push(token.id);
      continue;
    }
    for (let wi = 0; wi < words.length; wi++) {
      ids.push(`${token.id}#w${wi}`);
    }
  }
  return ids;
}

function parseChunkSpan(
  puzzlePartId: string,
  partTokens: readonly PartToken[],
): { firstId: string; lastId: string } | null {
  const match = /^chunk-\d+-(.+)$/.exec(puzzlePartId);
  if (!match) return null;

  const rest = match[1];
  const candidateIds = expandedPuzzleTokenIds(partTokens);

  for (const firstId of candidateIds) {
    const prefix = `${firstId}-`;
    if (!rest.startsWith(prefix)) continue;
    const lastId = rest.slice(prefix.length);
    if (candidateIds.includes(lastId)) {
      return { firstId, lastId };
    }
  }

  return null;
}

/**
 * Resolve underlying `PartToken` rows for a puzzle piece without modifying puzzle logic.
 */
export function resolvePuzzlePartTokens(
  puzzlePartId: string,
  partTokens: readonly PartToken[],
): PartToken[] {
  if (partTokens.length === 0) return [];

  const byId = new Map(partTokens.map((token) => [token.id, token]));
  const sorted = [...partTokens].sort((a, b) => a.order - b.order);

  const expandedMatch = /^(.+)#w\d+$/.exec(puzzlePartId);
  if (expandedMatch) {
    const parent = byId.get(expandedMatch[1]);
    return parent ? [parent] : [];
  }

  const chunkSpan = parseChunkSpan(puzzlePartId, partTokens);
  if (chunkSpan) {
    const firstBase = basePartTokenId(chunkSpan.firstId);
    const lastBase = basePartTokenId(chunkSpan.lastId);
    const firstIdx = sorted.findIndex((token) => token.id === firstBase);
    const lastIdx = sorted.findIndex((token) => token.id === lastBase);
    if (firstIdx === -1 || lastIdx === -1) return [];
    const start = Math.min(firstIdx, lastIdx);
    const end = Math.max(firstIdx, lastIdx);
    return sorted.slice(start, end + 1);
  }

  if (puzzlePartId === "fallback") {
    return sorted.filter((token) => token.visibleInPuzzle);
  }

  const direct = byId.get(puzzlePartId);
  return direct ? [direct] : [];
}

function representativeLookupToken(
  tokens: readonly DictionaryLookupToken[],
  fallbackText: string,
  fallbackId: string,
): DictionaryLookupToken {
  const representative = pickRepresentativeLookupToken(tokens);
  if (!representative) {
    const word = optionalTrimmed(fallbackText);
    return { id: fallbackId, text: word ?? fallbackText };
  }

  return {
    id: representative.id ?? fallbackId,
    text: representative.text,
    ...(optionalTrimmed(representative.senseId)
      ? { senseId: representative.senseId }
      : {}),
    ...(optionalTrimmed(representative.dictionaryEntryId)
      ? { dictionaryEntryId: representative.dictionaryEntryId }
      : {}),
    ...(optionalTrimmed(representative.matchedPhrase)
      ? { matchedPhrase: representative.matchedPhrase }
      : {}),
  };
}

/**
 * Build a lookup context for a puzzle piece, inspecting all underlying part tokens.
 */
export function resolvePuzzlePartLookup(
  puzzlePartId: string,
  partTokens: readonly PartToken[] | null | undefined,
  fallbackText: string,
): DictionaryLookupContext {
  if (!partTokens || partTokens.length === 0) {
    const word = optionalTrimmed(fallbackText);
    return word ? { word } : {};
  }

  const underlying = resolvePuzzlePartTokens(puzzlePartId, partTokens);
  if (underlying.length === 0) {
    const word = optionalTrimmed(fallbackText);
    return word ? { word } : {};
  }

  return resolveTokensLookupContext(underlying);
}

export function resolvePuzzlePartLookupToken(
  puzzlePartId: string,
  partTokens: readonly PartToken[] | null | undefined,
  fallbackText: string,
): DictionaryLookupToken {
  if (!partTokens || partTokens.length === 0) {
    const word = optionalTrimmed(fallbackText);
    return { id: puzzlePartId, text: word ?? fallbackText };
  }

  const underlying = resolvePuzzlePartTokens(puzzlePartId, partTokens);
  if (underlying.length === 0) {
    const word = optionalTrimmed(fallbackText);
    return { id: puzzlePartId, text: word ?? fallbackText };
  }

  return representativeLookupToken(underlying, fallbackText, puzzlePartId);
}

export function resolveDictionaryLookupToken(
  token: DictionaryLookupToken,
): DictionaryLookupContext {
  return partTokenToLookupContext(token);
}

/**
 * Map authoritative `parts.tokens` into per-word caption click targets.
 * Preserves dictionary metadata that `tokenizeCaption()` drops.
 */
/**
 * Re-sync a caption click target with authoritative `parts.tokens` metadata.
 * Handles merged clip ids (`clip::token-7`) and expanded word ids (`token-7#w1`).
 */
export function resolveCaptionTokenLookup(
  captionToken: DictionaryLookupToken,
  partTokens: readonly PartToken[] | null | undefined,
): DictionaryLookupToken {
  if (!partTokens?.length) return captionToken;

  const captionId = optionalTrimmed(captionToken.id);
  if (!captionId) return captionToken;

  const baseId = basePartTokenId(captionId);
  const byId = new Map(partTokens.map((token) => [token.id, token]));
  const partToken = byId.get(baseId) ?? byId.get(captionId);
  if (!partToken) return captionToken;

  const text = optionalTrimmed(captionToken.text) ?? partToken.text.trim();
  return captionTokenFromPartToken(partToken, captionId, text);
}

export function partTokensToCaptionTokens(
  tokens: readonly PartToken[] | null | undefined,
): DictionaryLookupToken[] {
  if (!tokens?.length) return [];

  // Preserve pipeline / merge order. Per-clip `order` restarts at 1 and must not be sorted globally.
  const out: DictionaryLookupToken[] = [];

  for (const token of tokens) {
    const display = String(token.text ?? "").trim();
    if (!display) continue;

    const words = display.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (words.length === 1) {
      out.push(captionTokenFromPartToken(token, token.id, words[0]));
      continue;
    }

    for (let wi = 0; wi < words.length; wi++) {
      out.push(captionTokenFromPartToken(token, `${token.id}#w${wi}`, words[wi]));
    }
  }

  return out;
}

function captionTokenFromPartToken(
  token: PartToken,
  id: string,
  text: string,
): DictionaryLookupToken {
  return {
    id,
    text,
    ...(optionalTrimmed(token.senseId) ? { senseId: token.senseId } : {}),
    ...(optionalTrimmed(token.dictionaryEntryId)
      ? { dictionaryEntryId: token.dictionaryEntryId }
      : {}),
    ...(optionalTrimmed(token.matchedPhrase)
      ? { matchedPhrase: token.matchedPhrase }
      : {}),
  };
}
