import type { TokenPromotionPolicy } from "../voiceMatchingConfig";
import { collectTokenObservationCandidates } from "./observations";
import {
  evolveTokenKnowledge,
  groupPromotedFormsByExpected,
  mergePromotedTokenKnowledge,
} from "./promotion";
import { SEED_TOKEN_KNOWLEDGE } from "./seed";
import type { TokenKnowledgeEntry } from "./types";
import {
  type TokenPromotionContext,
  validateTokenObservationCandidates,
} from "./validation";

export type BuildPromotedTokenKnowledgeInput = {
  tokenStats?: Parameters<typeof collectTokenObservationCandidates>[0]["tokenStats"];
  context?: TokenPromotionContext;
  policy?: Partial<TokenPromotionPolicy>;
  /** Existing knowledge to evolve rather than replace. */
  existing?: readonly TokenKnowledgeEntry[];
};

/**
 * Observation → validation → promotion → knowledge entries.
 * Returns promoted knowledge only — does not mutate the active base.
 */
export function buildPromotedTokenKnowledge(
  input: BuildPromotedTokenKnowledgeInput = {},
): TokenKnowledgeEntry[] {
  const candidates = collectTokenObservationCandidates({
    tokenStats: input.tokenStats,
  });

  const validated = validateTokenObservationCandidates(
    candidates,
    input.context ?? {},
    input.policy,
  );

  const base = mergePromotedTokenKnowledge(
    SEED_TOKEN_KNOWLEDGE,
    input.existing ?? [],
  );

  return evolveTokenKnowledge(base, validated);
}

/** @deprecated Use buildPromotedTokenKnowledge. */
export const buildAdaptiveTokenKnowledge = buildPromotedTokenKnowledge;

export type BuildAdaptiveTokenKnowledgeInput = BuildPromotedTokenKnowledgeInput;
