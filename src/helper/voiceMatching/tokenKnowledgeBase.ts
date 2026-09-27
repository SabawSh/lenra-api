import {
  createInMemoryTokenKnowledgeBase,
  InMemoryTokenKnowledgeBase as InMemoryTokenKnowledgeBaseImpl,
  tokenKnowledgeEntriesEqual,
} from "./tokenKnowledgeBase/memoryStore";
import { buildPromotedTokenKnowledge } from "./tokenKnowledgeBase/adaptiveLearning";
import { SEED_TOKEN_KNOWLEDGE } from "./tokenKnowledgeBase/seed";
import { ADAPTIVE_TOKEN_KNOWLEDGE_ENABLED } from "./voiceMatchingConfig";
import type {
  TokenKnowledgeBase,
  TokenKnowledgeEntry,
} from "./tokenKnowledgeBase/types";

export type {
  TokenKnowledgeBase,
  TokenKnowledgeEntry,
  TokenObservationCandidate,
  PromotedTokenForm,
  ValidatedTokenObservation,
  TokenObservationSource,
} from "./tokenKnowledgeBase/types";
export { TOKEN_KNOWLEDGE_SCHEMA_VERSION } from "./tokenKnowledgeBase/types";

export {
  collectTokenObservationCandidates,
} from "./tokenKnowledgeBase/observations";
export {
  validateTokenObservationCandidate,
  validateTokenObservationCandidates,
  type TokenPromotionContext,
  type TokenValidationRejectReason,
} from "./tokenKnowledgeBase/validation";
export {
  promoteValidatedObservation,
  promoteValidatedObservations,
  groupPromotedFormsByExpected,
  mergePromotedTokenKnowledge,
  evolveTokenKnowledge,
  upsertPromotedForm,
} from "./tokenKnowledgeBase/promotion";
export {
  buildPromotedTokenKnowledge,
  buildAdaptiveTokenKnowledge,
  type BuildPromotedTokenKnowledgeInput,
  type BuildAdaptiveTokenKnowledgeInput,
} from "./tokenKnowledgeBase/adaptiveLearning";
export { mergeTokenKnowledge } from "./tokenKnowledgeBase/merge";
export { SEED_TOKEN_KNOWLEDGE } from "./tokenKnowledgeBase/seed";
export { InMemoryTokenKnowledgeBase } from "./tokenKnowledgeBase/memoryStore";
export type {
  AdaptiveTokenLearningConfig,
  TokenPromotionPolicy,
} from "./voiceMatchingConfig";
export {
  DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG,
  DEFAULT_TOKEN_PROMOTION_POLICY,
  ADAPTIVE_TOKEN_KNOWLEDGE_ENABLED,
} from "./voiceMatchingConfig";

let activeKnowledgeBase: TokenKnowledgeBase = createInMemoryTokenKnowledgeBase();
let knowledgeRevision = 0;

/** Replace the knowledge base backend (e.g. database) without changing matcher code. */
export function setTokenKnowledgeBase(base: TokenKnowledgeBase): void {
  activeKnowledgeBase = base;
  knowledgeRevision += 1;
}

export function getTokenKnowledgeBase(): TokenKnowledgeBase {
  return activeKnowledgeBase;
}

export function getTokenKnowledgeRevision(): number {
  return knowledgeRevision;
}

export function lookupTokenKnowledge(
  expectedToken: string,
): TokenKnowledgeEntry | null {
  return activeKnowledgeBase.lookup(expectedToken);
}

export function getTokenKnowledgeEntries(): readonly TokenKnowledgeEntry[] {
  return activeKnowledgeBase.getEntries();
}

/**
 * Learning loop (in-memory): observation → validation → promotion → knowledge.
 * Returns true only when promoted knowledge changed (lexicon cache may rebuild).
 */
export function refreshAdaptiveTokenKnowledge(): boolean {
  if (!ADAPTIVE_TOKEN_KNOWLEDGE_ENABLED) return false;

  const current = activeKnowledgeBase.getEntries();
  const next = buildPromotedTokenKnowledge({
    existing: current,
  });

  if (tokenKnowledgeEntriesEqual(current, next)) {
    return false;
  }

  setTokenKnowledgeBase(new InMemoryTokenKnowledgeBaseImpl(next));
  return true;
}
