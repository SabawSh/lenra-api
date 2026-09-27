import type { VoiceMatcherConfig } from "./types";

/** Sliding-window / transcript limits. */
export const DEFAULT_MAX_RECENT_TOKENS = 25;

/** Evidence gate — frozen lexical rules. */
export const MIN_TOKEN_COVERAGE = 0.5;
export const MIN_ORDER_PRESERVATION = 1;
export const MAX_INSERTION_SLACK = 2;
export const MAX_DELETION_SLACK = 1;
export const SINGLE_TOKEN_MAX_SPEECH_SPAN = 3;

/** Alignment gate — frozen phonetic alignment rules. */
export const MIN_ALIGNMENT_TOKEN_SIMILARITY = 0.55;

/** Pronunciation gate — frozen per-token phonetic rules. */
export const MIN_PRONUNCIATION_SIMILARITY = 0.58;

/** DecisionEngine — phrase similarity acceptance. */
export const DEFAULT_PHRASE_SIMILARITY_THRESHOLD = 0.9;

/** DecisionEngine — knowledge observation weighted confidence. */
export const DEFAULT_PHRASE_KNOWLEDGE_THRESHOLD = 0.72;

/** DecisionEngine — minimum shared tokens to consider a knowledge window. */
export const KNOWLEDGE_MIN_TOKEN_OVERLAP = 2;

/** Adaptive learning filters — used by buildAdaptivePhraseKnowledge only. */
export type AdaptivePhraseLearningConfig = {
  minObservationCount: number;
  minConfidence: number;
  maxObservationsPerPhrase: number;
};

/** Adaptive learning filters — used by buildAdaptiveTokenKnowledge only. */
export type AdaptiveTokenLearningConfig = {
  minObservationCount: number;
  minConfidence: number;
  maxObservationsPerToken: number;
};

export const DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG: AdaptivePhraseLearningConfig =
  {
    minObservationCount: 10,
    minConfidence: 0.35,
    maxObservationsPerPhrase: 5,
  };

export const DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG: AdaptiveTokenLearningConfig =
  {
    minObservationCount: 10,
    minConfidence: 0.35,
    maxObservationsPerToken: 5,
  };

/** Validation + promotion policy for token observation → knowledge pipeline. */
export type TokenPromotionPolicy = {
  minObservationCount: number;
  minConfidence: number;
  maxPromotedFormsPerToken: number;
};

export const DEFAULT_TOKEN_PROMOTION_POLICY: TokenPromotionPolicy = {
  minObservationCount: DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG.minObservationCount,
  minConfidence: DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG.minConfidence,
  maxPromotedFormsPerToken:
    DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG.maxObservationsPerToken,
};

/**
 * Enables the in-memory learning loop: validated analytics candidates are merged
 * on top of seed knowledge and made available to the matcher via the active
 * knowledge base. Seed always remains the base until adaptive learning matures.
 */
export const ADAPTIVE_KNOWLEDGE_ENABLED = true;

/**
 * Enables the in-memory token learning loop: validated analytics candidates are
 * merged on top of seed token knowledge and folded into the session lexicon.
 */
export const ADAPTIVE_TOKEN_KNOWLEDGE_ENABLED = true;

function parseThresholdEnv(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(1, Math.max(0, parsed));
}

export const DEFAULT_VOICE_MATCHING_CONFIG: Required<VoiceMatcherConfig> = {
  maxRecentTokens: DEFAULT_MAX_RECENT_TOKENS,
  phraseSimilarityThreshold: parseThresholdEnv(
    process.env.VOICE_MATCH_PHRASE_SIMILARITY_THRESHOLD,
    DEFAULT_PHRASE_SIMILARITY_THRESHOLD,
  ),
  phraseKnowledgeThreshold: parseThresholdEnv(
    process.env.VOICE_MATCH_PHRASE_KNOWLEDGE_THRESHOLD,
    DEFAULT_PHRASE_KNOWLEDGE_THRESHOLD,
  ),
};

export type ResolvedVoiceMatchingConfig = Required<VoiceMatcherConfig>;

export function resolveVoiceMatchingConfig(
  overrides?: VoiceMatcherConfig,
): ResolvedVoiceMatchingConfig {
  return {
    maxRecentTokens:
      overrides?.maxRecentTokens ?? DEFAULT_VOICE_MATCHING_CONFIG.maxRecentTokens,
    phraseSimilarityThreshold:
      overrides?.phraseSimilarityThreshold ??
      DEFAULT_VOICE_MATCHING_CONFIG.phraseSimilarityThreshold,
    phraseKnowledgeThreshold:
      overrides?.phraseKnowledgeThreshold ??
      DEFAULT_VOICE_MATCHING_CONFIG.phraseKnowledgeThreshold,
  };
}
