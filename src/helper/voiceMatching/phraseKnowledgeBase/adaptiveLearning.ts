import type { PhraseObservationStats } from "@/helper/speech/sttAnalytics/types";
import { exportSnapshot } from "@/helper/speech/sttAnalytics";
import {
  expectedPhraseKey,
  normalizeExpectedPhrase,
  normalizeObservedPhrase,
} from "./normalizePhrase";
import type { Observation, PhraseKnowledgeCandidate } from "./types";

import {
  DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG,
  type AdaptivePhraseLearningConfig,
} from "../voiceMatchingConfig";

type AggregatedVariant = {
  observedPhrase: string;
  count: number;
  averageConfidence: number | null;
};

function resolveConfig(
  overrides?: Partial<AdaptivePhraseLearningConfig>,
): AdaptivePhraseLearningConfig {
  return {
    minObservationCount:
      overrides?.minObservationCount ??
      DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG.minObservationCount,
    minConfidence:
      overrides?.minConfidence ??
      DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG.minConfidence,
    maxObservationsPerPhrase:
      overrides?.maxObservationsPerPhrase ??
      DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG.maxObservationsPerPhrase,
  };
}

function aggregateVariants(
  stats: PhraseObservationStats,
): AggregatedVariant[] {
  const byObserved = new Map<
    string,
    { count: number; confidenceSum: number; confidenceSamples: number }
  >();

  for (const variant of stats.variants) {
    const observedPhrase = normalizeObservedPhrase(variant.observedTranscript);
    if (!observedPhrase) continue;

    let bucket = byObserved.get(observedPhrase);
    if (!bucket) {
      bucket = { count: 0, confidenceSum: 0, confidenceSamples: 0 };
      byObserved.set(observedPhrase, bucket);
    }

    bucket.count += variant.count;
    if (variant.averageConfidence !== null) {
      bucket.confidenceSum += variant.averageConfidence * variant.count;
      bucket.confidenceSamples += variant.count;
    }
  }

  return [...byObserved.entries()].map(([observedPhrase, bucket]) => ({
    observedPhrase,
    count: bucket.count,
    averageConfidence:
      bucket.confidenceSamples > 0
        ? bucket.confidenceSum / bucket.confidenceSamples
        : null,
  }));
}

function passesAdaptiveFilters(
  expectedPhrase: string,
  variant: AggregatedVariant,
  config: AdaptivePhraseLearningConfig,
): boolean {
  if (variant.count < config.minObservationCount) return false;

  if (variant.averageConfidence === null) return false;
  if (variant.averageConfidence < config.minConfidence) return false;

  const expectedNorm = normalizeExpectedPhrase(expectedPhrase);
  if (variant.observedPhrase === expectedNorm) return false;

  return true;
}

function toCandidateObservations(
  expectedPhrase: string,
  stats: PhraseObservationStats,
  config: AdaptivePhraseLearningConfig,
): Observation[] {
  const aggregated = aggregateVariants(stats)
    .filter((variant) => passesAdaptiveFilters(expectedPhrase, variant, config))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.observedPhrase.localeCompare(right.observedPhrase),
    )
    .slice(0, config.maxObservationsPerPhrase);

  return aggregated.map((variant) => ({
    observedPhrase: variant.observedPhrase,
    count: variant.count,
    confidence: variant.averageConfidence ?? 0,
    source: "analytics" as const,
  }));
}

export type BuildAdaptivePhraseKnowledgeInput = {
  phraseStats?: readonly PhraseObservationStats[];
  config?: Partial<AdaptivePhraseLearningConfig>;
};

/**
 * Convert STT analytics phrase statistics into candidate observations.
 * Returns candidates only — nothing is written to the active knowledge base.
 */
export function buildAdaptivePhraseKnowledge(
  input: BuildAdaptivePhraseKnowledgeInput = {},
): PhraseKnowledgeCandidate[] {
  const config = resolveConfig(input.config);
  const phraseStats = input.phraseStats ?? exportSnapshot().phraseStats;

  const candidates: PhraseKnowledgeCandidate[] = [];

  for (const stats of phraseStats) {
    const observations = toCandidateObservations(
      stats.expectedPhrase,
      stats,
      config,
    );
    if (observations.length === 0) continue;

    candidates.push({
      expectedPhrase: normalizeExpectedPhrase(stats.expectedPhrase),
      observations,
    });
  }

  candidates.sort((left, right) =>
    expectedPhraseKey(left.expectedPhrase).localeCompare(
      expectedPhraseKey(right.expectedPhrase),
    ),
  );

  return candidates;
}
