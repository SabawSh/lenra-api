import type { DictionaryLookupResult } from "@/lib/db/queries/dictionary";
import type { DictionaryLookupContext } from "@/lib/dictionary/lookupContext";
import { indexDictionaryEntry } from "@/lib/dictionary/senseIndex";

export type DictionaryLookupDto = DictionaryLookupResult;

const lookupCache = new Map<string, DictionaryLookupDto>();
const inflight = new Map<string, Promise<DictionaryLookupDto>>();

/** Prefixed cache key for word-based lookups. */
export function wordCacheKey(word: string): string {
  return `word:${word.trim().toLowerCase()}`;
}

/** Prefixed cache key for ID-based lookups. */
export function idCacheKey(id: string): string {
  return `id:${id.trim()}`;
}

/** Prefixed cache key for sense-based lookups. */
export function senseCacheKey(id: string): string {
  return `sense:${id.trim()}`;
}

/** @deprecated Legacy bare-word keys from pre-Phase-2 sessions. */
function legacyWordCacheKey(word: string): string {
  return word.trim().toLowerCase();
}

function getCachedByWord(word: string): DictionaryLookupDto | undefined {
  const trimmed = word.trim();
  if (!trimmed) return undefined;
  return (
    lookupCache.get(wordCacheKey(trimmed)) ??
    lookupCache.get(legacyWordCacheKey(trimmed))
  );
}

function storeInCache(entry: DictionaryLookupDto): void {
  indexDictionaryEntry(entry);

  if (entry.word.trim()) {
    lookupCache.set(wordCacheKey(entry.word), entry);
    lookupCache.set(legacyWordCacheKey(entry.word), entry);
  }
  if (entry.lemma.trim()) {
    lookupCache.set(wordCacheKey(entry.lemma), entry);
    lookupCache.set(legacyWordCacheKey(entry.lemma), entry);
  }
  if (entry.id) {
    lookupCache.set(idCacheKey(entry.id), entry);
  }
}

async function readErrorReason(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      return parsed.error ? `${parsed.error} (HTTP ${res.status})` : text;
    } catch {
      return text;
    }
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function fetchDictionaryEntryById(
  dictionaryEntryId: string,
  options?: { bypassCache?: boolean },
): Promise<DictionaryLookupDto> {
  const key = idCacheKey(dictionaryEntryId);
  if (!key || key === "id:") {
    throw new Error("dictionaryEntryId is required");
  }

  if (!options?.bypassCache) {
    const cached = lookupCache.get(key);
    if (cached) return cached;

    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const request = (async () => {
    const res = await fetch(
      `/api/dictionary?id=${encodeURIComponent(dictionaryEntryId.trim())}`,
    );

    if (!res.ok) {
      const reason = await readErrorReason(res);
      throw new Error(`Dictionary lookup failed: ${reason}`);
    }

    const data = (await res.json()) as DictionaryLookupDto;
    storeInCache(data);
    return data;
  })();

  inflight.set(key, request);

  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

async function fetchDictionaryEntryByWord(
  word: string,
  options?: { bypassCache?: boolean },
): Promise<DictionaryLookupDto> {
  const trimmed = word.trim();
  if (!trimmed) {
    throw new Error("Word is required");
  }

  const key = wordCacheKey(trimmed);

  if (!options?.bypassCache) {
    const cached = getCachedByWord(trimmed);
    if (cached) return cached;

    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const request = (async () => {
    const res = await fetch(
      `/api/dictionary?word=${encodeURIComponent(trimmed)}`,
    );

    if (!res.ok) {
      const reason = await readErrorReason(res);
      throw new Error(`Dictionary lookup failed: ${reason}`);
    }

    const data = (await res.json()) as DictionaryLookupDto;
    storeInCache(data);
    return data;
  })();

  inflight.set(key, request);

  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

async function fetchDictionaryEntryBySenseId(
  senseId: string,
  options?: { bypassCache?: boolean; displayWord?: string },
): Promise<DictionaryLookupDto> {
  const key = senseCacheKey(senseId);
  if (!key || key === "sense:") {
    throw new Error("senseId is required");
  }

  if (!options?.bypassCache) {
    const cached = lookupCache.get(key);
    if (cached) return cached;

    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const request = (async () => {
    const params = new URLSearchParams({ senseId: senseId.trim() });
    const displayWord = options?.displayWord?.trim();
    if (displayWord) {
      params.set("word", displayWord);
    }

    const res = await fetch(`/api/dictionary?${params.toString()}`);

    if (!res.ok) {
      const reason = await readErrorReason(res);
      throw new Error(`Dictionary lookup failed: ${reason}`);
    }

    const data = (await res.json()) as DictionaryLookupDto;
    storeInCache(data);
    return data;
  })();

  inflight.set(key, request);

  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Unified dictionary lookup. Prefers `dictionaryEntryId` (no lemmatization),
 * then `senseId`, then `word` (server-side lemmatization).
 */
export async function fetchDictionaryEntry(
  context: DictionaryLookupContext,
  options?: { bypassCache?: boolean },
): Promise<DictionaryLookupDto> {
  const dictionaryEntryId = context.dictionaryEntryId?.trim();
  if (dictionaryEntryId) {
    return fetchDictionaryEntryById(dictionaryEntryId, options);
  }

  const senseId = context.senseId?.trim();
  if (senseId) {
    return fetchDictionaryEntryBySenseId(senseId, {
      ...options,
      displayWord: context.word ?? context.matchedPhrase,
    });
  }

  const word = context.word?.trim();
  if (word) {
    return fetchDictionaryEntryByWord(word, options);
  }

  throw new Error(
    "Dictionary lookup requires dictionaryEntryId, senseId, or word",
  );
}

export async function fetchDictionaryWord(
  word: string,
  options?: { bypassCache?: boolean },
): Promise<DictionaryLookupDto> {
  return fetchDictionaryEntry({ word }, options);
}

export function primeDictionaryCache(entries: DictionaryLookupDto[]) {
  for (const entry of entries) {
    storeInCache(entry);
  }
}

export function markDictionaryEntrySaved(
  dictionaryEntryId: string,
  word: string,
) {
  for (const [key, value] of lookupCache.entries()) {
    if (value.id === dictionaryEntryId) {
      lookupCache.set(key, { ...value, saved: true });
    }
  }

  const updated = lookupCache.get(idCacheKey(dictionaryEntryId));
  if (updated) {
    storeInCache({ ...updated, saved: true });
  }

  const trimmedWord = word.trim();
  if (trimmedWord) {
    const byWord = getCachedByWord(trimmedWord);
    if (byWord?.id === dictionaryEntryId) {
      storeInCache({ ...byWord, saved: true });
    }
  }
}

export async function saveUserVocabularyEntry(
  dictionaryEntryId: string,
  options?: {
    clipId?: string | null;
    word?: string | null;
    lemma?: string | null;
    sentence?: string | null;
  },
) {
  const body: Record<string, string> = { dictionaryEntryId };
  const clipId = options?.clipId?.trim();
  if (clipId) body.clipId = clipId;
  const word = options?.word?.trim();
  if (word) body.word = word;
  const lemma = options?.lemma?.trim();
  if (lemma) body.lemma = lemma;
  const sentence = options?.sentence?.trim();
  if (sentence) body.sentence = sentence;

  const res = await fetch("/api/user-vocabulary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const reason = await readErrorReason(res);
    throw new Error(`Failed to save vocabulary: ${reason}`);
  }

  return (await res.json()) as {
    success: true;
    created: boolean;
    entry: {
      id: number;
      dictionaryEntryId: string;
    };
    contextualCard: {
      id: number;
      clipId: string;
      word: string;
      normalizedWord: string;
    } | null;
  };
}
