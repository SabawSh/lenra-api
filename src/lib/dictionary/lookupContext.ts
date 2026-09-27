export type DictionaryLookupContext = {
  word?: string;
  dictionaryEntryId?: string;
  senseId?: string;
  matchedPhrase?: string;
  /**
   * When opened from a learning Clip, the canonical part id.
   * Used only for contextual `saved_vocabulary_cards` bridge — not for lookup.
   */
  clipId?: string;
  /** Clip caption/sentence for the contextual saved card. */
  sentence?: string;
};

export type DictionaryLookupInput = string | DictionaryLookupContext;

function optionalTrimmedString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalize caller input into a lookup context.
 * Strings become `{ word }`; object fields are trimmed and omitted when empty.
 */
export function normalizeLookupInput(
  input: DictionaryLookupInput,
): DictionaryLookupContext {
  if (typeof input === "string") {
    const word = optionalTrimmedString(input);
    return word ? { word } : {};
  }

  const context: DictionaryLookupContext = {};

  const word = optionalTrimmedString(input.word);
  if (word) context.word = word;

  const dictionaryEntryId = optionalTrimmedString(input.dictionaryEntryId);
  if (dictionaryEntryId) context.dictionaryEntryId = dictionaryEntryId;

  const senseId = optionalTrimmedString(input.senseId);
  if (senseId) context.senseId = senseId;

  const matchedPhrase = optionalTrimmedString(input.matchedPhrase);
  if (matchedPhrase) context.matchedPhrase = matchedPhrase;

  const clipId = optionalTrimmedString(input.clipId);
  if (clipId) context.clipId = clipId;

  const sentence = optionalTrimmedString(input.sentence);
  if (sentence) context.sentence = sentence;

  return context;
}
