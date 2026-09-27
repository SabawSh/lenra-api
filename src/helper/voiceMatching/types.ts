import type { PhraseKnowledgeEntry } from "./phraseKnowledgeBase/types";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import type { VoiceCandidate, ResolutionPassResult } from "./candidateTypes";

export type RejectionReason =
  | "INSUFFICIENT_EVIDENCE"
  | "LOW_TOKEN_COVERAGE"
  | "LOW_ORDER_PRESERVATION"
  | "INSERTION_TOLERANCE_EXCEEDED"
  | "DELETION_TOLERANCE_EXCEEDED"
  | "LOW_PRONUNCIATION"
  | "SPEECH_TOO_LONG"
  | "OVERLAP_CONSUMED"
  | "SUBSUMED_BY_LONGER_TILE"
  | "AMBIGUOUS_PREFIX"
  | "NO_WINDOW";

/** Preview may defer short tiles that are prefixes of longer unsolved phrases. */
export type PlacementCommitmentLevel = "preview" | "final";

/** Why an accepted tile was accepted (explainability). */
export type AcceptReason =
  | "GATE_MATCH"
  | "PHRASE_SIMILARITY"
  | "PHRASE_KNOWLEDGE";

export type VoiceTile = {
  id: string;
  text: string;
};

export type ConsumedSpan = {
  start: number;
  end: number;
};

export type MatchedSpan = {
  start: number;
  end: number;
};

export type VoiceMatcherConfig = {
  maxRecentTokens?: number;
  phraseSimilarityThreshold?: number;
  phraseKnowledgeThreshold?: number;
};

export type MatchVoiceTilesInput = {
  transcript: readonly string[];
  unsolvedTiles: readonly VoiceTile[];
  consumedSpans?: readonly ConsumedSpan[];
  config?: VoiceMatcherConfig;
  /**
   * Phrase knowledge injected by the caller (never read from a global).
   * Keeps the matcher a pure function of its inputs.
   */
  phraseKnowledge?: readonly PhraseKnowledgeEntry[];
  /**
   * Cached pronunciation surfaces for tile tokens (built at puzzle/session
   * creation). When omitted, only orthographic forms are used.
   */
  tokenMatchLexicon?: VoiceMatchLexicon;
  /**
   * Full-sentence tile ids in expected order (originalParts). Used only to
   * resolve ownership among duplicate-text tiles so shuffled pool order cannot
   * steal the first spoken occurrence from an earlier sentence tile.
   */
  expectedTileOrder?: readonly string[];
  /**
   * Preview defers ambiguous short prefixes of longer unsolved phrases.
   * Final (mic release) may accept the short tile when only the prefix was spoken.
   */
  commitmentLevel?: PlacementCommitmentLevel;
};

export type AcceptedTile = {
  tileId: string;
  span: MatchedSpan;
  /** Why the matcher accepted this candidate (explainability). */
  acceptReason: AcceptReason;
};

export type RejectedTile = {
  tileId: string;
  reason: RejectionReason;
};

export type MatchVoiceTilesResult = {
  acceptedTiles: AcceptedTile[];
  rejectedTiles: RejectedTile[];
  /** All candidates before resolver (diagnostics / replay). */
  candidates: VoiceCandidate[];
  /** Resolver output — sole semantic owner. */
  resolution: ResolutionPassResult;
};

export type SpeechWindow = {
  start: number;
  end: number;
  tokens: string[];
};

export type RecentSpeechSlice = {
  tokens: string[];
  startOffset: number;
  fullTokenCount: number;
};

export type TokenAlignment = {
  expectedIndex: number;
  spokenIndex: number;
  expected: string;
  spoken: string;
};

export type AlignmentResult = {
  alignments: TokenAlignment[];
  matchedTileTokenCount: number;
  tileTokenCount: number;
  orderPreserved: boolean;
  insertionCount: number;
  deletionCount: number;
};

export type GateResult =
  | { pass: true }
  | { pass: false; reason: RejectionReason };
