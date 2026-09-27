import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";

/** Hints for STT engines — independent from the voice matcher. */
export type SpeechContextHints = {
  expectedPhrases: string[];
};

export type SpeechContextHintsTile = {
  text: string;
};

export type BuildSpeechContextHintsOptions = {
  /** Deepgram Nova-3 allows up to 100 keyterms per request. */
  maxPhrases?: number;
};

const DEFAULT_MAX_PHRASES = 100;

function normalizePhrase(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Build expected phrase hints from unsolved puzzle tiles.
 * Normalizes whitespace, deduplicates (case-insensitive), drops empties.
 */
export function buildSpeechContextHints(
  unsolvedTiles: readonly SpeechContextHintsTile[],
  options?: BuildSpeechContextHintsOptions,
): SpeechContextHints {
  const maxPhrases = options?.maxPhrases ?? DEFAULT_MAX_PHRASES;
  const seen = new Set<string>();
  const expectedPhrases: string[] = [];

  for (const tile of unsolvedTiles) {
    const normalized = normalizePhrase(tile.text);
    if (!normalized) continue;

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    expectedPhrases.push(normalized);
    if (expectedPhrases.length >= maxPhrases) break;
  }

  return { expectedPhrases };
}

export function logSpeechContextHintsDebug(
  _hints: SpeechContextHints,
  _deepgramHintsSent?: readonly string[],
): void {
  if (!resolveSttFallbackConfig().debug) return;
}
