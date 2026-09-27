import { normalizeText, normalizeSpeechToken } from "@/helper/speech/normalizer";
import type { SpeechRecognitionSource } from "@/helper/speech/speechRecognitionResult";
import type {
  PhraseObservationBucket,
  PhraseObservationInput,
  PhraseObservationStats,
  PhraseObservationVariant,
  SttAcceptedEvent,
  SttAnalyticsSnapshot,
  SttAnalyticsStore,
  SttAttemptEvent,
  SttBrowserStats,
  SttEngineStats,
  SttRejectedEvent,
  SttRetryEvent,
  TokenObservationBucket,
  TokenObservationInput,
  TokenObservationStats,
  TokenObservationVariant,
} from "./types";

function normalizeObservedTranscript(transcript: string): string {
  return normalizeText(transcript).trim();
}

function normalizeExpectedPhrase(phrase: string): string {
  return phrase.trim().replace(/\s+/g, " ");
}

function normalizeExpectedToken(token: string): string {
  return normalizeSpeechToken(token);
}

function normalizeObservedToken(token: string): string {
  return normalizeSpeechToken(token);
}

function createEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function observationBucketKey(input: {
  expectedPhrase: string;
  observedTranscript: string;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
}): string {
  return [
    normalizeExpectedPhrase(input.expectedPhrase).toLowerCase(),
    normalizeObservedTranscript(input.observedTranscript),
    input.engine,
    input.browser,
    input.language,
  ].join("\u0001");
}

function tokenObservationBucketKey(input: {
  expectedToken: string;
  observedToken: string;
  engine: SpeechRecognitionSource;
  browser: string;
  language: string;
}): string {
  return [
    normalizeExpectedToken(input.expectedToken),
    normalizeObservedToken(input.observedToken),
    input.engine,
    input.browser,
    input.language,
  ].join("\u0001");
}

function updateConfidenceStats(
  bucket: {
    count: number;
    averageConfidence: number | null;
    minConfidence: number | null;
    maxConfidence: number | null;
  },
  confidence: number | undefined,
): void {
  if (confidence === undefined || !Number.isFinite(confidence)) return;

  const priorSamples =
    bucket.averageConfidence === null ? 0 : bucket.count - 1;
  const priorAverage = bucket.averageConfidence ?? 0;
  const nextSamples = priorSamples + 1;

  bucket.averageConfidence =
    priorSamples === 0
      ? confidence
      : (priorAverage * priorSamples + confidence) / nextSamples;
  bucket.minConfidence =
    bucket.minConfidence === null
      ? confidence
      : Math.min(bucket.minConfidence, confidence);
  bucket.maxConfidence =
    bucket.maxConfidence === null
      ? confidence
      : Math.max(bucket.maxConfidence, confidence);
}

function buildPhraseObservationStats(
  expectedPhrase: string,
  buckets: readonly PhraseObservationBucket[],
): PhraseObservationStats {
  let totalObservations = 0;
  for (const bucket of buckets) {
    totalObservations += bucket.count;
  }

  const variants: PhraseObservationVariant[] = buckets
    .map((bucket) => ({
      observedTranscript: bucket.observedTranscript,
      count: bucket.count,
      probability:
        totalObservations > 0 ? bucket.count / totalObservations : 0,
      engine: bucket.engine,
      browser: bucket.browser,
      language: bucket.language,
      averageConfidence: bucket.averageConfidence,
      minConfidence: bucket.minConfidence,
      maxConfidence: bucket.maxConfidence,
    }))
    .sort((a, b) => b.count - a.count || b.probability - a.probability);

  return {
    expectedPhrase,
    totalObservations,
    variants,
  };
}

function buildTokenObservationStats(
  expectedToken: string,
  buckets: readonly TokenObservationBucket[],
): TokenObservationStats {
  let totalObservations = 0;
  for (const bucket of buckets) {
    totalObservations += bucket.count;
  }

  const variants: TokenObservationVariant[] = buckets
    .map((bucket) => ({
      observedToken: bucket.observedToken,
      count: bucket.count,
      probability:
        totalObservations > 0 ? bucket.count / totalObservations : 0,
      engine: bucket.engine,
      browser: bucket.browser,
      language: bucket.language,
      averageConfidence: bucket.averageConfidence,
      minConfidence: bucket.minConfidence,
      maxConfidence: bucket.maxConfidence,
    }))
    .sort((a, b) => b.count - a.count || b.probability - a.probability);

  return {
    expectedToken,
    totalObservations,
    variants,
  };
}

/**
 * In-memory STT analytics store.
 * Data is lost on page reload — suitable for client-side collection until a
 * persistent backend is wired in.
 */
export class InMemorySttAnalyticsStore implements SttAnalyticsStore {
  private readonly attempts: SttAttemptEvent[] = [];
  private readonly retries: SttRetryEvent[] = [];
  private readonly accepted: SttAcceptedEvent[] = [];
  private readonly rejected: SttRejectedEvent[] = [];
  private readonly phraseBuckets = new Map<string, PhraseObservationBucket>();
  private readonly phraseIndex = new Map<string, Set<string>>();
  private readonly tokenBuckets = new Map<string, TokenObservationBucket>();
  private readonly tokenIndex = new Map<string, Set<string>>();

  saveAttempt(event: SttAttemptEvent): void {
    this.attempts.push(event);
  }

  saveRetry(event: SttRetryEvent): void {
    this.retries.push(event);
  }

  saveAccepted(event: SttAcceptedEvent): void {
    this.accepted.push(event);
  }

  saveRejected(event: SttRejectedEvent): void {
    this.rejected.push(event);
  }

  recordPhraseObservation(input: PhraseObservationInput): void {
    const expectedPhrase = normalizeExpectedPhrase(input.expectedPhrase);
    const observedTranscript = normalizeObservedTranscript(
      input.observedTranscript,
    );
    if (!expectedPhrase || !observedTranscript) return;

    const bucketKey = observationBucketKey({
      expectedPhrase,
      observedTranscript,
      engine: input.engine,
      browser: input.browser,
      language: input.language,
    });

    let bucket = this.phraseBuckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        observedTranscript,
        engine: input.engine,
        browser: input.browser,
        language: input.language,
        count: 0,
        averageConfidence: null,
        minConfidence: null,
        maxConfidence: null,
      };
      this.phraseBuckets.set(bucketKey, bucket);

      const expectedKey = expectedPhrase.toLowerCase();
      let keys = this.phraseIndex.get(expectedKey);
      if (!keys) {
        keys = new Set<string>();
        this.phraseIndex.set(expectedKey, keys);
      }
      keys.add(bucketKey);
    }

    bucket.count += 1;
    updateConfidenceStats(bucket, input.confidence);
  }

  recordTokenObservation(input: TokenObservationInput): void {
    const expectedToken = normalizeExpectedToken(input.expectedToken);
    const observedToken = normalizeObservedToken(input.observedToken);
    if (!expectedToken || !observedToken || expectedToken === observedToken) {
      return;
    }

    const bucketKey = tokenObservationBucketKey({
      expectedToken,
      observedToken,
      engine: input.engine,
      browser: input.browser,
      language: input.language,
    });

    let bucket = this.tokenBuckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        observedToken,
        engine: input.engine,
        browser: input.browser,
        language: input.language,
        count: 0,
        averageConfidence: null,
        minConfidence: null,
        maxConfidence: null,
      };
      this.tokenBuckets.set(bucketKey, bucket);

      let keys = this.tokenIndex.get(expectedToken);
      if (!keys) {
        keys = new Set<string>();
        this.tokenIndex.set(expectedToken, keys);
      }
      keys.add(bucketKey);
    }

    bucket.count += 1;
    updateConfidenceStats(bucket, input.confidence);
  }

  getPhraseObservationStats(expectedPhrase: string): PhraseObservationStats | undefined {
    const normalized = normalizeExpectedPhrase(expectedPhrase).toLowerCase();
    const bucketKeys = this.phraseIndex.get(normalized);
    if (!bucketKeys || bucketKeys.size === 0) return undefined;

    const buckets: PhraseObservationBucket[] = [];
    for (const key of bucketKeys) {
      const bucket = this.phraseBuckets.get(key);
      if (bucket) buckets.push(bucket);
    }

    if (buckets.length === 0) return undefined;
    return buildPhraseObservationStats(expectedPhrase.trim(), buckets);
  }

  getTokenObservationStats(
    expectedToken: string,
  ): TokenObservationStats | undefined {
    const normalized = normalizeExpectedToken(expectedToken);
    const bucketKeys = this.tokenIndex.get(normalized);
    if (!bucketKeys || bucketKeys.size === 0) return undefined;

    const buckets: TokenObservationBucket[] = [];
    for (const key of bucketKeys) {
      const bucket = this.tokenBuckets.get(key);
      if (bucket) buckets.push(bucket);
    }

    if (buckets.length === 0) return undefined;
    return buildTokenObservationStats(normalized, buckets);
  }

  getEngineStats(): SttEngineStats[] {
    const byEngine = new Map<SpeechRecognitionSource, SttEngineStats>();

    const ensure = (engine: SpeechRecognitionSource): SttEngineStats => {
      let stats = byEngine.get(engine);
      if (!stats) {
        stats = {
          engine,
          attempts: 0,
          acceptances: 0,
          rejections: 0,
          phraseObservations: 0,
        };
        byEngine.set(engine, stats);
      }
      return stats;
    };

    for (const attempt of this.attempts) {
      const stats = ensure(attempt.engineUsed);
      stats.attempts += 1;
      stats.acceptances += attempt.acceptedTiles.length;
      stats.rejections += attempt.rejectedTiles.length;
    }

    for (const bucket of this.phraseBuckets.values()) {
      const stats = ensure(bucket.engine);
      stats.phraseObservations += bucket.count;
    }

    return [...byEngine.values()].sort((a, b) => b.attempts - a.attempts);
  }

  getBrowserStats(): SttBrowserStats[] {
    const byBrowser = new Map<string, SttBrowserStats>();

    const ensure = (browser: string): SttBrowserStats => {
      let stats = byBrowser.get(browser);
      if (!stats) {
        stats = {
          browser,
          attempts: 0,
          acceptances: 0,
          rejections: 0,
          phraseObservations: 0,
        };
        byBrowser.set(browser, stats);
      }
      return stats;
    };

    for (const attempt of this.attempts) {
      const stats = ensure(attempt.browser);
      stats.attempts += 1;
      stats.acceptances += attempt.acceptedTiles.length;
      stats.rejections += attempt.rejectedTiles.length;
    }

    for (const bucket of this.phraseBuckets.values()) {
      const stats = ensure(bucket.browser);
      stats.phraseObservations += bucket.count;
    }

    return [...byBrowser.values()].sort((a, b) => b.attempts - a.attempts);
  }

  exportSnapshot(): SttAnalyticsSnapshot {
    const phraseStats: PhraseObservationStats[] = [];

    for (const [expectedKey, bucketKeys] of this.phraseIndex) {
      const buckets: PhraseObservationBucket[] = [];
      for (const key of bucketKeys) {
        const bucket = this.phraseBuckets.get(key);
        if (bucket) buckets.push(bucket);
      }
      if (buckets.length === 0) continue;

      const displayPhrase = buckets[0]
        ? this.findDisplayPhraseForKey(expectedKey, buckets[0].observedTranscript)
        : expectedKey;

      phraseStats.push(buildPhraseObservationStats(displayPhrase, buckets));
    }

    phraseStats.sort((a, b) => b.totalObservations - a.totalObservations);

    const tokenStats: TokenObservationStats[] = [];
    for (const [expectedToken, bucketKeys] of this.tokenIndex) {
      const buckets: TokenObservationBucket[] = [];
      for (const key of bucketKeys) {
        const bucket = this.tokenBuckets.get(key);
        if (bucket) buckets.push(bucket);
      }
      if (buckets.length === 0) continue;
      tokenStats.push(buildTokenObservationStats(expectedToken, buckets));
    }
    tokenStats.sort((a, b) => b.totalObservations - a.totalObservations);

    return {
      attempts: [...this.attempts],
      retries: [...this.retries],
      accepted: [...this.accepted],
      rejected: [...this.rejected],
      phraseStats,
      tokenStats,
      engineStats: this.getEngineStats(),
      browserStats: this.getBrowserStats(),
    };
  }

  private findDisplayPhraseForKey(
    expectedKey: string,
    _observedTranscript: string,
  ): string {
    for (const attempt of this.attempts) {
      for (const tile of [...attempt.unsolvedTiles, ...attempt.expectedTiles]) {
        if (normalizeExpectedPhrase(tile.text).toLowerCase() === expectedKey) {
          return normalizeExpectedPhrase(tile.text);
        }
      }
    }
    return expectedKey;
  }
}

export function createInMemorySttAnalyticsStore(): InMemorySttAnalyticsStore {
  return new InMemorySttAnalyticsStore();
}

export { createEventId };
