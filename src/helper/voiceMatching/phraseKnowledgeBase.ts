import {
  createInMemoryPhraseKnowledgeBase,
  InMemoryPhraseKnowledgeBase as InMemoryPhraseKnowledgeBaseImpl,
} from "./phraseKnowledgeBase/memoryStore";
import { buildAdaptivePhraseKnowledge } from "./phraseKnowledgeBase/adaptiveLearning";
import { mergePhraseKnowledge } from "./phraseKnowledgeBase/merge";
import { SEED_PHRASE_KNOWLEDGE } from "./phraseKnowledgeBase/seed";
import { ADAPTIVE_KNOWLEDGE_ENABLED } from "./voiceMatchingConfig";
import type {
  PhraseKnowledgeBase,
  PhraseKnowledgeEntry,
} from "./phraseKnowledgeBase/types";

export type {
  Observation,
  ObservationSource,
  PhraseKnowledgeBase,
  PhraseKnowledgeCandidate,
  PhraseKnowledgeEntry,
} from "./phraseKnowledgeBase/types";

export {
  buildAdaptivePhraseKnowledge,
  type BuildAdaptivePhraseKnowledgeInput,
} from "./phraseKnowledgeBase/adaptiveLearning";
export { mergePhraseKnowledge } from "./phraseKnowledgeBase/merge";
export { SEED_PHRASE_KNOWLEDGE } from "./phraseKnowledgeBase/seed";
export { InMemoryPhraseKnowledgeBase } from "./phraseKnowledgeBase/memoryStore";
export type { AdaptivePhraseLearningConfig } from "./voiceMatchingConfig";
export {
  DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG,
  ADAPTIVE_KNOWLEDGE_ENABLED,
} from "./voiceMatchingConfig";

let activeKnowledgeBase: PhraseKnowledgeBase =
  createInMemoryPhraseKnowledgeBase();

/** Replace the knowledge base backend (e.g. database) without changing matcher code. */
export function setPhraseKnowledgeBase(base: PhraseKnowledgeBase): void {
  activeKnowledgeBase = base;
}

export function getPhraseKnowledgeBase(): PhraseKnowledgeBase {
  return activeKnowledgeBase;
}

export function lookupPhraseKnowledge(
  expectedPhrase: string,
): PhraseKnowledgeEntry | null {
  return activeKnowledgeBase.lookup(expectedPhrase);
}

export function getPhraseKnowledgeEntries(): readonly PhraseKnowledgeEntry[] {
  return activeKnowledgeBase.getEntries();
}

/**
 * Learning loop (in-memory): rebuild the active knowledge base from
 * seed + validated adaptive candidates derived from recorded STT analytics.
 *
 * Analytics never changes matcher behavior directly. Learning only produces
 * candidates; `buildAdaptivePhraseKnowledge` applies the validation filters
 * (min observation count / min confidence); `mergePhraseKnowledge` keeps seed
 * as the authoritative base. This is the only place candidates become available
 * to the matcher.
 *
 * Safe to call after each recorded attempt — it is deterministic and pure aside
 * from swapping the active base.
 */
export function refreshAdaptivePhraseKnowledge(): void {
  if (!ADAPTIVE_KNOWLEDGE_ENABLED) return;

  const candidates = buildAdaptivePhraseKnowledge();
  const merged = mergePhraseKnowledge(SEED_PHRASE_KNOWLEDGE, candidates);
  setPhraseKnowledgeBase(new InMemoryPhraseKnowledgeBaseImpl(merged));
}
