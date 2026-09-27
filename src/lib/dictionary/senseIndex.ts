import type { DictionarySense } from "@/lib/dictionary/types";

export type IndexedSenseRef = {
  senseId: string;
  sense: DictionarySense;
  lemma: string;
  entryId: string;
};

const senseById = new Map<string, IndexedSenseRef>();

export function indexDictionaryEntry(entry: {
  id: string | null;
  lemma: string;
  senses: DictionarySense[];
}): void {
  if (!entry.id) return;

  for (const sense of entry.senses) {
    const senseId = sense.id?.trim();
    if (!senseId) continue;

    senseById.set(senseId, {
      senseId,
      sense,
      lemma: entry.lemma,
      entryId: entry.id,
    });
  }
}

export function lookupIndexedSense(
  senseId: string,
): IndexedSenseRef | undefined {
  const trimmed = senseId.trim();
  return trimmed ? senseById.get(trimmed) : undefined;
}

export function clearSenseIndex(): void {
  senseById.clear();
}
