import { expectedPhraseKey } from "./normalizePhrase";
import { SEED_PHRASE_KNOWLEDGE } from "./seed";
import type {
  PhraseKnowledgeBase,
  PhraseKnowledgeEntry,
} from "./types";

function cloneEntry(entry: PhraseKnowledgeEntry): PhraseKnowledgeEntry {
  return {
    expectedPhrase: entry.expectedPhrase,
    observations: entry.observations.map((observation) => ({ ...observation })),
  };
}

/**
 * In-memory phrase knowledge base.
 * Returns known observations only — no matching or rescue logic.
 */
export class InMemoryPhraseKnowledgeBase implements PhraseKnowledgeBase {
  private readonly entries = new Map<string, PhraseKnowledgeEntry>();

  constructor(seed: readonly PhraseKnowledgeEntry[] = SEED_PHRASE_KNOWLEDGE) {
    for (const entry of seed) {
      const key = expectedPhraseKey(entry.expectedPhrase);
      if (!key) continue;
      this.entries.set(key, cloneEntry(entry));
    }
  }

  lookup(expectedPhrase: string): PhraseKnowledgeEntry | null {
    const key = expectedPhraseKey(expectedPhrase);
    if (!key) return null;

    const entry = this.entries.get(key);
    if (!entry) return null;

    return cloneEntry(entry);
  }

  getEntries(): readonly PhraseKnowledgeEntry[] {
    return [...this.entries.values()].map((entry) => cloneEntry(entry));
  }
}

export function createInMemoryPhraseKnowledgeBase(
  seed: readonly PhraseKnowledgeEntry[] = SEED_PHRASE_KNOWLEDGE,
): InMemoryPhraseKnowledgeBase {
  return new InMemoryPhraseKnowledgeBase(seed);
}
