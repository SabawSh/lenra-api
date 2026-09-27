/**
 * Runtime speech-configuration snapshot + deterministic fingerprint.
 *
 * Metadata / diagnostics only — does not drive matching, placement, or replay.
 * Any value that changes observable speech behavior should appear here so
 * historical fixtures can be compared to the current runtime.
 */
import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";
import { FUZZY_NAME_LEVENSHTEIN_MAX } from "@/helper/speech/specificNames";
import { RAPID_FINAL_DEDUPE_MS } from "@/helper/speech/voiceSession/handleSpeechEvents";
import {
  ADAPTIVE_KNOWLEDGE_ENABLED,
  ADAPTIVE_TOKEN_KNOWLEDGE_ENABLED,
  DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG,
  DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG,
  DEFAULT_TOKEN_PROMOTION_POLICY,
  KNOWLEDGE_MIN_TOKEN_OVERLAP,
  MAX_DELETION_SLACK,
  MAX_INSERTION_SLACK,
  MIN_ALIGNMENT_TOKEN_SIMILARITY,
  MIN_ORDER_PRESERVATION,
  MIN_PRONUNCIATION_SIMILARITY,
  MIN_TOKEN_COVERAGE,
  SINGLE_TOKEN_MAX_SPEECH_SPAN,
  resolveVoiceMatchingConfig,
} from "@/helper/voiceMatching/voiceMatchingConfig";
import { MAX_VARIANT_SPAN } from "@/helper/voiceMatching/variantSpanMatch";
import { AUTO_PAUSE_GAP_MS } from "./createReplayRecorder";
import {
  SPEECH_ADAPTIVE_TEACHER_VERSION,
  SPEECH_CAPTION_VERSION,
  SPEECH_LEXICON_VERSION,
  SPEECH_MATCHER_VERSION,
  SPEECH_NORMALIZER_VERSION,
  SPEECH_PIPELINE_VERSION,
  SPEECH_PLACEMENT_VERSION,
} from "./speechPipelineVersions";

/**
 * Mirrored acquisition timers (engines are not imported here to avoid
 * bundling STT clients into fingerprint helpers). Keep in sync with:
 * webSpeechEngine / deepgramEngine COALESCE_FINAL_MS and
 * deepgramEngine FINAL_STABILIZE_MS.
 */
export const FINGERPRINT_COALESCE_FINAL_MS = 16;
export const FINGERPRINT_DEEPGRAM_FINAL_STABILIZE_MS = 220;

/**
 * Readable runtime speech configuration.
 * Shape is stable for debugging; unknown future keys may be added.
 */
export type SpeechConfigSnapshot = {
  schemaVersion: 1;
  versions: {
    pipelineVersion: string;
    captionVersion: string;
    adaptiveTeacherVersion: string;
    lexiconVersion: string;
    normalizerVersion: string;
    matcherVersion: string;
    placementVersion: string;
  };
  matcher: {
    maxRecentTokens: number;
    phraseSimilarityThreshold: number;
    phraseKnowledgeThreshold: number;
    minTokenCoverage: number;
    minOrderPreservation: number;
    maxInsertionSlack: number;
    maxDeletionSlack: number;
    singleTokenMaxSpeechSpan: number;
    minAlignmentTokenSimilarity: number;
    minPronunciationSimilarity: number;
    knowledgeMinTokenOverlap: number;
    maxVariantSpan: number;
  };
  placement: {
    /** Committed tiles never move/delete; later events only append. */
    appendOnly: true;
    /** Preview/final feed priorPlacement for sticky selection. */
    stickyPriorPlacement: true;
    /** Preview defers short tiles that are prefixes of longer unsolved phrases. */
    ambiguousPrefixDeferOnPreview: true;
    commitmentLevels: readonly ["preview", "final"];
  };
  retry: {
    fallbackEnabled: boolean;
    retryConfidence: number;
  };
  adaptive: {
    phraseKnowledgeEnabled: boolean;
    tokenKnowledgeEnabled: boolean;
    phraseLearning: typeof DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG;
    tokenLearning: typeof DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG;
    tokenPromotion: typeof DEFAULT_TOKEN_PROMOTION_POLICY;
  };
  lexicon: {
    maxVariantSpan: number;
    sessionFrozenDuringVoice: true;
  };
  normalizer: {
    /** REPLACEMENTS keys in normalizer.ts (gonna/wanna/gotta). */
    slangExpansions: readonly ["gonna", "wanna", "gotta"];
    /** know you / know i → no you / no i */
    knowNoRewrite: true;
    /** Apostrophes stripped for matching. */
    stripApostrophes: true;
    /** Hyphens treated as word boundaries. */
    hyphenAsBoundary: true;
  };
  merge: {
    /** Caption-aware suffix/prefix overlap merge is used in production. */
    captionAwareOverlap: true;
  };
  rewrite: {
    /** rewriteSpeechTextWithKnownNames runs but is NOT matcher input. */
    tracedOnlyNotUsedForPlacement: true;
    fuzzyNameLevenshteinMax: number;
  };
  session: {
    rapidFinalDedupeMs: number;
    autoPauseGapMs: number;
  };
  acquisition: {
    coalesceFinalMs: number;
    deepgramFinalStabilizeMs: number;
  };
};

/**
 * Canonical JSON with sorted object keys (arrays keep order).
 * Ensures the same config always hashes the same way.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/** FNV-1a 64-bit → 16 hex chars (portable, sync, Node + browser). */
export function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function fingerprintSpeechConfigSnapshot(
  snapshot: SpeechConfigSnapshot,
): string {
  const canonical = stableStringify(snapshot);
  return `fnv1a64:${fnv1a64Hex(canonical)}`;
}

/**
 * Collect current runtime speech configuration.
 * Reads live resolve*() so env overrides are reflected.
 */
export function getSpeechConfigSnapshot(): SpeechConfigSnapshot {
  const matching = resolveVoiceMatchingConfig();
  const retry = resolveSttFallbackConfig();

  return {
    schemaVersion: 1,
    versions: {
      pipelineVersion: SPEECH_PIPELINE_VERSION,
      captionVersion: SPEECH_CAPTION_VERSION,
      adaptiveTeacherVersion: SPEECH_ADAPTIVE_TEACHER_VERSION,
      lexiconVersion: SPEECH_LEXICON_VERSION,
      normalizerVersion: SPEECH_NORMALIZER_VERSION,
      matcherVersion: SPEECH_MATCHER_VERSION,
      placementVersion: SPEECH_PLACEMENT_VERSION,
    },
    matcher: {
      maxRecentTokens: matching.maxRecentTokens,
      phraseSimilarityThreshold: matching.phraseSimilarityThreshold,
      phraseKnowledgeThreshold: matching.phraseKnowledgeThreshold,
      minTokenCoverage: MIN_TOKEN_COVERAGE,
      minOrderPreservation: MIN_ORDER_PRESERVATION,
      maxInsertionSlack: MAX_INSERTION_SLACK,
      maxDeletionSlack: MAX_DELETION_SLACK,
      singleTokenMaxSpeechSpan: SINGLE_TOKEN_MAX_SPEECH_SPAN,
      minAlignmentTokenSimilarity: MIN_ALIGNMENT_TOKEN_SIMILARITY,
      minPronunciationSimilarity: MIN_PRONUNCIATION_SIMILARITY,
      knowledgeMinTokenOverlap: KNOWLEDGE_MIN_TOKEN_OVERLAP,
      maxVariantSpan: MAX_VARIANT_SPAN,
    },
    placement: {
      appendOnly: true,
      stickyPriorPlacement: true,
      ambiguousPrefixDeferOnPreview: true,
      commitmentLevels: ["preview", "final"],
    },
    retry: {
      fallbackEnabled: retry.fallbackEnabled,
      retryConfidence: retry.retryConfidence,
    },
    adaptive: {
      phraseKnowledgeEnabled: ADAPTIVE_KNOWLEDGE_ENABLED,
      tokenKnowledgeEnabled: ADAPTIVE_TOKEN_KNOWLEDGE_ENABLED,
      phraseLearning: { ...DEFAULT_ADAPTIVE_PHRASE_LEARNING_CONFIG },
      tokenLearning: { ...DEFAULT_ADAPTIVE_TOKEN_LEARNING_CONFIG },
      tokenPromotion: { ...DEFAULT_TOKEN_PROMOTION_POLICY },
    },
    lexicon: {
      maxVariantSpan: MAX_VARIANT_SPAN,
      sessionFrozenDuringVoice: true,
    },
    normalizer: {
      slangExpansions: ["gonna", "wanna", "gotta"],
      knowNoRewrite: true,
      stripApostrophes: true,
      hyphenAsBoundary: true,
    },
    merge: {
      captionAwareOverlap: true,
    },
    rewrite: {
      tracedOnlyNotUsedForPlacement: true,
      fuzzyNameLevenshteinMax: FUZZY_NAME_LEVENSHTEIN_MAX,
    },
    session: {
      rapidFinalDedupeMs: RAPID_FINAL_DEDUPE_MS,
      autoPauseGapMs: AUTO_PAUSE_GAP_MS,
    },
    acquisition: {
      coalesceFinalMs: FINGERPRINT_COALESCE_FINAL_MS,
      deepgramFinalStabilizeMs: FINGERPRINT_DEEPGRAM_FINAL_STABILIZE_MS,
    },
  };
}

export function getCurrentPipelineFingerprint(): string {
  return fingerprintSpeechConfigSnapshot(getSpeechConfigSnapshot());
}
