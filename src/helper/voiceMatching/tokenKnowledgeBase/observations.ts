import type { TokenObservationStats } from "@/helper/speech/sttAnalytics/types";
import { exportSnapshot } from "@/helper/speech/sttAnalytics";
import {
  expectedTokenKey,
  normalizeExpectedToken,
  normalizeObservedToken,
} from "./normalizeToken";
import type { TokenObservationCandidate } from "./types";

type AggregatedVariant = {
  observedToken: string;
  count: number;
  averageConfidence: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
};

function aggregateVariants(stats: TokenObservationStats): AggregatedVariant[] {
  const byObserved = new Map<
    string,
    {
      count: number;
      confidenceSum: number;
      confidenceSamples: number;
      firstSeenAt: number;
      lastSeenAt: number;
    }
  >();

  for (const variant of stats.variants) {
    const observedToken = normalizeObservedToken(variant.observedToken);
    if (!observedToken) continue;

    let bucket = byObserved.get(observedToken);
    if (!bucket) {
      bucket = {
        count: 0,
        confidenceSum: 0,
        confidenceSamples: 0,
        firstSeenAt: Number.POSITIVE_INFINITY,
        lastSeenAt: 0,
      };
      byObserved.set(observedToken, bucket);
    }

    bucket.count += variant.count;
    if (variant.averageConfidence !== null) {
      bucket.confidenceSum += variant.averageConfidence * variant.count;
      bucket.confidenceSamples += variant.count;
    }
    bucket.firstSeenAt = Math.min(bucket.firstSeenAt, stats.totalObservations);
    bucket.lastSeenAt = Math.max(bucket.lastSeenAt, stats.totalObservations);
  }

  const now = Date.now();

  return [...byObserved.entries()].map(([observedToken, bucket]) => ({
    observedToken,
    count: bucket.count,
    averageConfidence:
      bucket.confidenceSamples > 0
        ? bucket.confidenceSum / bucket.confidenceSamples
        : null,
    firstSeenAt: Number.isFinite(bucket.firstSeenAt) ? bucket.firstSeenAt : now,
    lastSeenAt: bucket.lastSeenAt > 0 ? bucket.lastSeenAt : now,
  }));
}

export type CollectTokenObservationCandidatesInput = {
  tokenStats?: readonly TokenObservationStats[];
};

/**
 * Collect raw token observation candidates from analytics.
 * No validation or promotion — observations only.
 */
export function collectTokenObservationCandidates(
  input: CollectTokenObservationCandidatesInput = {},
): TokenObservationCandidate[] {
  const tokenStats = input.tokenStats ?? exportSnapshot().tokenStats;
  const candidates: TokenObservationCandidate[] = [];

  for (const stats of tokenStats) {
    const expectedToken = normalizeExpectedToken(stats.expectedToken);
    if (!expectedToken) continue;

    const now = Date.now();

    for (const variant of aggregateVariants(stats)) {
      candidates.push({
        expectedToken,
        observedToken: variant.observedToken,
        observationCount: variant.count,
        averageConfidence: variant.averageConfidence,
        source: "analytics",
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }

  candidates.sort((left, right) =>
    expectedTokenKey(left.expectedToken).localeCompare(
      expectedTokenKey(right.expectedToken),
    ) ||
    left.observedToken.localeCompare(right.observedToken),
  );

  return candidates;
}
