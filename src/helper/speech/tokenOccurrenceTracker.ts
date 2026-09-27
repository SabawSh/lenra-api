/**
 * Token identity & consumption tracking for voice matching.
 * Same surface word at different transcript indices are distinct instances.
 */

export type SpeechToken = {
  text: string;
  index: number;
  consumed: boolean;
};

export type TranscriptMatchIndices = {
  transcriptStart: number;
  transcriptConsumed: number;
  transcriptIndices?: readonly number[];
};

/** Build indexed speech tokens; optional consumed flags seed from session state. */
export function buildSpeechTokens(
  tokens: readonly string[],
  consumed?: readonly boolean[],
): SpeechToken[] {
  return tokens.map((text, index) => ({
    text,
    index,
    consumed: consumed?.[index] ?? false,
  }));
}

export function consumedFlags(speechTokens: readonly SpeechToken[]): boolean[] {
  return speechTokens.map((token) => token.consumed);
}

export function applyConsumedFlags(
  speechTokens: SpeechToken[],
  consumed: readonly boolean[],
): void {
  for (let i = 0; i < speechTokens.length; i++) {
    speechTokens[i]!.consumed = consumed[i] ?? false;
  }
}

export function markIndicesConsumed(
  speechTokens: SpeechToken[],
  indices: readonly number[],
): void {
  for (const index of indices) {
    if (index < 0 || index >= speechTokens.length) continue;
    speechTokens[index]!.consumed = true;
  }
}

export function indicesFromMatchDetail(match: TranscriptMatchIndices): number[] {
  if (match.transcriptIndices?.length) {
    return [...match.transcriptIndices];
  }
  return Array.from(
    { length: match.transcriptConsumed },
    (_, offset) => match.transcriptStart + offset,
  );
}

export function markConsumedFromMatchLog(
  speechTokens: SpeechToken[],
  matches: readonly TranscriptMatchIndices[],
): void {
  for (const match of matches) {
    markIndicesConsumed(speechTokens, indicesFromMatchDetail(match));
  }
}

/** Map normalized text → transcript indices (all occurrences). */
export function buildTokenOccurrenceMap(
  speechTokens: readonly SpeechToken[],
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const token of speechTokens) {
    const key = token.text.toLowerCase();
    const list = map.get(key);
    if (list) list.push(token.index);
    else map.set(key, [token.index]);
  }
  return map;
}

export function indicesOverlapConsumed(
  speechTokens: readonly SpeechToken[],
  indices: readonly number[],
): boolean {
  return indices.some((index) => speechTokens[index]?.consumed);
}

/** First unused index from a candidate list (preserves transcript order). */
export function nextUnusedIndex(
  speechTokens: readonly SpeechToken[],
  candidateIndices: readonly number[],
): number | null {
  for (const index of candidateIndices) {
    const token = speechTokens[index];
    if (token && !token.consumed) return index;
  }
  return null;
}

export function unconsumedIndices(
  speechTokens: readonly SpeechToken[],
): number[] {
  const indices: number[] = [];
  for (const token of speechTokens) {
    if (!token.consumed) indices.push(token.index);
  }
  return indices;
}

export function markConsumedBooleanArray(
  consumed: boolean[],
  indices: readonly number[],
): void {
  for (const index of indices) {
    if (index >= 0 && index < consumed.length) consumed[index] = true;
  }
}

export function mergeConsumedFromMatchLog(
  consumed: boolean[],
  matches: readonly TranscriptMatchIndices[],
): void {
  for (const match of matches) {
    markConsumedBooleanArray(consumed, indicesFromMatchDetail(match));
  }
}
